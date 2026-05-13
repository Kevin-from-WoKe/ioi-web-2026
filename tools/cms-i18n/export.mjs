#!/usr/bin/env node
/**
 * Export Contentful EN entries to a multi-sheet Excel workbook for translation.
 *
 * Uses the Content Management API (CMA) so the same token works for both
 * export and import, and access to any environment is automatic.
 *
 * Each content type becomes one sheet.
 * Columns: entry_id | field_id | field_label | en_value | cn_value | _type
 *
 * - Only Symbol, Text, and RichText fields marked as localized are exported.
 * - Rich text is flattened to plain text; import.mjs re-wraps it.
 * - Existing zh-Hans values are pre-filled in cn_value (incremental re-runs).
 *
 * Usage:
 *   node export.mjs        # writes contentful-translations.xlsx
 *
 * .env options:
 *   CONTENTFUL_MANAGEMENT_TOKEN=...   # required
 *   CONTENTFUL_ENVIRONMENT=staging    # default: master
 */

import contentfulManagement from "contentful-management";
const { createClient } = contentfulManagement;
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────

async function loadEnv() {
  const envPath = resolve(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
await loadEnv();

// ── Config ────────────────────────────────────────────────────────────────────

const CMA_TOKEN   = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const SPACE_ID    = process.env.CONTENTFUL_SPACE_ID    || "slmipam661bk";
const ENVIRONMENT = process.env.CONTENTFUL_ENVIRONMENT || "master";
const LOCALE_SRC  = process.env.LOCALE_SOURCE || "en-US";
const LOCALE_TGT  = process.env.LOCALE_TARGET || "zh-CN";
const OUT_FILE    = resolve(__dirname, "contentful-translations.xlsx");

if (!CMA_TOKEN) {
  console.error("ERROR: CONTENTFUL_MANAGEMENT_TOKEN not set. Copy .env.example → .env and fill it in.");
  process.exit(1);
}

// ── Field helpers ─────────────────────────────────────────────────────────────

const TRANSLATABLE_TYPES = new Set(["Symbol", "Text", "RichText"]);

function isTranslatableField(field) {
  return field.localized && TRANSLATABLE_TYPES.has(field.type);
}

function richTextToPlain(node) {
  if (!node) return "";
  if (node.nodeType === "text") return node.value || "";
  if (Array.isArray(node.content)) {
    const parts = node.content.map(richTextToPlain).filter(Boolean);
    const tag = node.nodeType;
    if (tag === "paragraph" || tag.startsWith("heading-")) return parts.join("") + "\n\n";
    if (tag === "list-item") return "• " + parts.join("") + "\n";
    return parts.join("");
  }
  return "";
}

function getFieldValue(fields, fieldId, locale) {
  const f = fields?.[fieldId];
  if (!f) return "";
  const val = f[locale];
  if (val === undefined || val === null) return "";
  if (typeof val === "object" && val.nodeType === "document") {
    return richTextToPlain(val).trim();
  }
  return String(val).trim();
}

// ── Paginate entries via CMA ──────────────────────────────────────────────────

async function fetchAllEntries(env, contentTypeId) {
  const entries = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const page = await env.getEntries({
      content_type: contentTypeId,
      locale: "*",
      limit,
      skip,
      select: "sys.id,fields",
    });
    entries.push(...page.items);
    if (entries.length >= page.total) break;
    skip += page.items.length;
    if (page.items.length === 0) break;
  }

  return entries;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Connecting to Contentful space ${SPACE_ID} / environment "${ENVIRONMENT}" via CMA…`);

  const client = createClient({ accessToken: CMA_TOKEN });
  const space  = await client.getSpace(SPACE_ID);
  const env    = await space.getEnvironment(ENVIRONMENT);

  const ctPage = await env.getContentTypes({ limit: 200 });
  const contentTypes = ctPage.items;
  console.log(`Found ${contentTypes.length} content types.\n`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ioi-cms-i18n export.mjs";
  workbook.created = new Date();

  const HEADERS    = ["entry_id", "field_id", "field_label", "en_value", "cn_value", "_type"];
  const COL_WIDTHS = [28, 22, 22, 60, 60, 10];

  const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  const LOCKED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  const CN_FILL     = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } };

  let totalRows = 0;

  for (const ct of contentTypes) {
    const ctId   = ct.sys.id;
    const ctName = ct.name;

    const translatableFields = (ct.fields || []).filter(isTranslatableField);
    if (translatableFields.length === 0) {
      console.log(`  ⊘ ${ctName} — no localized text fields, skipping`);
      continue;
    }

    console.log(`  ◉ ${ctName} — ${translatableFields.length} translatable fields`);

    const entries  = await fetchAllEntries(env, ctId);
    const dataRows = [];

    for (const entry of entries) {
      const entryId = entry.sys.id;
      for (const field of translatableFields) {
        const enVal = getFieldValue(entry.fields, field.id, LOCALE_SRC);
        const cnVal = getFieldValue(entry.fields, field.id, LOCALE_TGT);
        if (!enVal) continue;
        dataRows.push([entryId, field.id, field.name, enVal, cnVal, field.type]);
      }
    }

    totalRows += dataRows.length;
    console.log(`    → ${dataRows.length} strings across ${entries.length} entries`);

    const sheet = workbook.addWorksheet(ctName.slice(0, 31), {
      views: [{ state: "frozen", xSplit: 3, ySplit: 1 }],
    });

    sheet.columns = HEADERS.map((h, i) => ({
      header: h,
      key: h,
      width: COL_WIDTHS[i],
      style: { alignment: { wrapText: true, vertical: "top" } },
    }));

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    headerRow.height = 22;

    for (const row of dataRows) {
      const r = sheet.addRow(row);
      r.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.alignment = { wrapText: true, vertical: "top" };
        if (colNum !== 5) {
          cell.fill = LOCKED_FILL;
          cell.font = { color: { argb: "FF666666" }, size: 10 };
        }
      });
      const cnCell = r.getCell(5);
      if (!cnCell.value) cnCell.fill = CN_FILL;
      cnCell.font = { size: 11 };
    }

    sheet.autoFilter = { from: "A1", to: "F1" };
  }

  await workbook.xlsx.writeFile(OUT_FILE);
  console.log(`\nDone. ${totalRows} strings exported to:\n  ${OUT_FILE}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open contentful-translations.xlsx`);
  console.log(`  2. Fill the yellow "cn_value" cells on each sheet`);
  console.log(`  3. Save and run:  node import.mjs`);
}

main().catch(err => {
  console.error("Export failed:", err.message || err);
  process.exit(1);
});
