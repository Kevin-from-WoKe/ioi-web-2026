#!/usr/bin/env node
/**
 * Export Contentful EN entries to a multi-sheet Excel workbook for translation.
 *
 * Uses the Content Delivery API (read-only) — no Management token needed.
 * The CDA token is the same one already in cms-config.js.
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
 *   (no .env required — CDA token is hard-coded below, same as cms-config.js)
 */

import ExcelJS from "exceljs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config (CDA — public read-only token, same as cms-config.js) ─────────────

const SPACE_ID    = "slmipam661bk";
const CDA_TOKEN   = "mzqVu_K9SJTw8LpTgpa2U5Q9zXpQfzSeImmh8VXdgMA";
const ENVIRONMENT = "master";
const LOCALE_SRC  = "en-US";
const LOCALE_TGT  = "zh-Hans";
const CDA_BASE    = `https://cdn.contentful.com/spaces/${SPACE_ID}/environments/${ENVIRONMENT}`;
const OUT_FILE    = resolve(__dirname, "contentful-translations.xlsx");

// ── CDA fetch helper ──────────────────────────────────────────────────────────

async function cdaGet(path, params = {}) {
  const url = new URL(CDA_BASE + path);
  url.searchParams.set("access_token", CDA_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CDA ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
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

// ── Paginate entries ──────────────────────────────────────────────────────────

async function fetchAllEntries(contentTypeId) {
  const entries = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const data = await cdaGet("/entries", {
      content_type: contentTypeId,
      locale: "*",
      limit,
      skip,
      select: "sys.id,fields",
    });
    entries.push(...data.items);
    if (entries.length >= data.total) break;
    skip += data.items.length;
    if (data.items.length === 0) break;
  }

  return entries;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Connecting to Contentful space ${SPACE_ID} via CDA…`);

  const ctData = await cdaGet("/content_types", { limit: 200 });
  const contentTypes = ctData.items;
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

    const entries  = await fetchAllEntries(ctId);
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
  console.log(`  3. Save and run:  node import.mjs  (needs CMA token in .env)`);
}

main().catch(err => {
  console.error("Export failed:", err.message || err);
  process.exit(1);
});
