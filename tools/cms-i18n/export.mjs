#!/usr/bin/env node
/**
 * Export Contentful EN entries to a multi-sheet Excel workbook for translation.
 *
 * Each content type becomes one sheet.
 * Columns: entry_id | field_id | field_label | en_value | cn_value | _type
 *
 * - Only Symbol, Text, and RichText fields that are localized are exported.
 * - Rich text is flattened to plain text for the translator; import re-wraps it.
 * - Existing zh-Hans values are pre-filled in cn_value so re-runs are incremental.
 *
 * Usage:
 *   cp .env.example .env   # fill in CONTENTFUL_MANAGEMENT_TOKEN
 *   npm install
 *   node export.mjs        # writes contentful-translations.xlsx
 */

import contentfulManagement from "contentful-management";
const { createClient } = contentfulManagement;
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

async function loadEnv() {
  const envPath = resolve(__dirname, ".env");
  if (existsSync(envPath)) {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

await loadEnv();

const CMA_TOKEN   = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const SPACE_ID    = process.env.CONTENTFUL_SPACE_ID    || "slmipam661bk";
const ENVIRONMENT = process.env.CONTENTFUL_ENVIRONMENT || "master";
const LOCALE_SRC  = process.env.LOCALE_SOURCE          || "en-US";
const LOCALE_TGT  = process.env.LOCALE_TARGET          || "zh-Hans";
const OUT_FILE    = resolve(__dirname, "contentful-translations.xlsx");

if (!CMA_TOKEN) {
  console.error("ERROR: CONTENTFUL_MANAGEMENT_TOKEN not set. Copy .env.example → .env and fill it in.");
  process.exit(1);
}

// ── Field helpers ────────────────────────────────────────────────────────────

const TRANSLATABLE_TYPES = new Set(["Symbol", "Text", "RichText"]);

function isTranslatableField(field) {
  if (!field.localized) return false;
  if (!TRANSLATABLE_TYPES.has(field.type)) return false;
  return true;
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

function getFieldValue(entry, fieldId, locale) {
  const f = entry.fields[fieldId];
  if (!f) return "";
  const val = f[locale];
  if (val === undefined || val === null) return "";
  if (typeof val === "object" && val.nodeType === "document") {
    return richTextToPlain(val).trim();
  }
  return String(val).trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Connecting to Contentful space ${SPACE_ID} (${ENVIRONMENT})…`);

  const client = createClient({ accessToken: CMA_TOKEN });
  const space  = await client.getSpace(SPACE_ID);
  const env    = await space.getEnvironment(ENVIRONMENT);

  const ctRes = await env.getContentTypes({ limit: 200 });
  const contentTypes = ctRes.items;
  console.log(`Found ${contentTypes.length} content types.\n`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ioi-cms-i18n export.mjs";
  workbook.created = new Date();

  const HEADERS = ["entry_id", "field_id", "field_label", "en_value", "cn_value", "_type"];
  const COL_WIDTHS = [28, 22, 22, 60, 60, 10];

  // Style constants
  const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  const LOCKED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  const CN_FILL     = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } }; // light yellow

  let totalRows = 0;

  for (const ct of contentTypes) {
    const ctId   = ct.sys.id;
    const ctName = ct.name;

    const translatableFields = ct.fields.filter(isTranslatableField);
    if (translatableFields.length === 0) {
      console.log(`  ⊘ ${ctName} (${ctId}) — no localized text fields, skipping`);
      continue;
    }

    console.log(`  ◉ ${ctName} (${ctId}) — ${translatableFields.length} translatable fields`);

    // Collect all rows first
    const dataRows = [];
    let skip = 0;
    const pageSize = 100;
    let total = Infinity;

    while (skip < total) {
      const res = await env.getEntries({ content_type: ctId, limit: pageSize, skip, locale: "*" });
      total = res.total;
      for (const entry of res.items) {
        const entryId = entry.sys.id;
        for (const field of translatableFields) {
          const enVal = getFieldValue(entry, field.id, LOCALE_SRC);
          const cnVal = getFieldValue(entry, field.id, LOCALE_TGT);
          if (!enVal) continue;
          dataRows.push([entryId, field.id, field.name, enVal, cnVal, field.type]);
        }
      }
      skip += res.items.length;
      if (res.items.length === 0) break;
    }

    totalRows += dataRows.length;
    console.log(`    → ${dataRows.length} strings across ${total} entries`);

    // Sheet name: Excel limit is 31 chars
    const sheet = workbook.addWorksheet(ctName.slice(0, 31), {
      views: [{ state: "frozen", xSplit: 3, ySplit: 1 }],
    });

    // Column definitions
    sheet.columns = HEADERS.map((h, i) => ({
      header: h,
      key: h,
      width: COL_WIDTHS[i],
      style: { alignment: { wrapText: true, vertical: "top" } },
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    headerRow.height = 22;

    // Add data rows with styling
    for (const row of dataRows) {
      const r = sheet.addRow(row);
      r.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.alignment = { wrapText: true, vertical: "top" };
        // Cols 1-3 (entry_id, field_id, field_label) and col 6 (_type) are read-only reference
        if (colNum !== 5) {
          cell.fill = LOCKED_FILL;
          cell.font = { color: { argb: "FF666666" }, size: 10 };
        }
      });
      // cn_value column (col 5) gets yellow highlight to guide translator
      const cnCell = r.getCell(5);
      if (!cnCell.value) {
        cnCell.fill = CN_FILL;
      }
      cnCell.font = { size: 11 };
    }

    // Auto-filter on header
    sheet.autoFilter = { from: "A1", to: `F1` };
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
