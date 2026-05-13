#!/usr/bin/env node
/**
 * Snapshot CN translations between xlsx and a git-trackable JSON file.
 *
 * Usage:
 *   node snapshot.mjs             # xlsx → translations-snapshot.json  (save)
 *   node snapshot.mjs --restore   # translations-snapshot.json → xlsx  (restore)
 *
 * The JSON is committed to git as a durable backup. The xlsx is gitignored
 * (binary, changes frequently) and can always be regenerated:
 *
 *   node export.mjs               # fresh xlsx from Contentful
 *   node snapshot.mjs --restore   # re-fill cn_value column from snapshot
 */

import ExcelJS from "exceljs";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const XLSX_FILE  = resolve(__dirname, "contentful-translations.xlsx");
const JSON_FILE  = resolve(__dirname, "translations-snapshot.json");

// ── Save: xlsx → JSON ─────────────────────────────────────────────────────────

async function save() {
  if (!existsSync(XLSX_FILE)) {
    console.error(`ERROR: ${XLSX_FILE} not found. Run export.mjs first.`);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(XLSX_FILE);

  // { entryId: { fieldId: cnValue } }
  const snapshot = {};
  let count = 0;

  for (const sheet of workbook.worksheets) {
    const headerRow = sheet.getRow(1).values;
    const ci = {};
    for (let c = 1; c < headerRow.length; c++) {
      if (headerRow[c]) ci[String(headerRow[c]).trim()] = c;
    }
    const iEntry = ci["entry_id"];
    const iField = ci["field_id"];
    const iCn    = ci["cn_value"];
    if (!iEntry || !iField || !iCn) continue;

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const entryId = String(row.getCell(iEntry).value || "").trim();
      const fieldId = String(row.getCell(iField).value || "").trim();
      const cnValue = String(row.getCell(iCn).value    || "").trim();
      if (!entryId || !fieldId || !cnValue) return;

      if (!snapshot[entryId]) snapshot[entryId] = {};
      snapshot[entryId][fieldId] = cnValue;
      count++;
    });
  }

  // Sort keys for stable diffs
  const sorted = Object.fromEntries(
    Object.entries(snapshot)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, fields]) => [id, Object.fromEntries(Object.entries(fields).sort())])
  );

  await writeFile(JSON_FILE, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  console.log(`Saved ${count} translations → ${JSON_FILE}`);
  console.log(`Entries: ${Object.keys(sorted).length}`);
}

// ── Restore: JSON → xlsx ──────────────────────────────────────────────────────

async function restore() {
  if (!existsSync(JSON_FILE)) {
    console.error(`ERROR: ${JSON_FILE} not found.`);
    process.exit(1);
  }
  if (!existsSync(XLSX_FILE)) {
    console.error(`ERROR: ${XLSX_FILE} not found. Run export.mjs first, then snapshot --restore.`);
    process.exit(1);
  }

  const snapshot = JSON.parse(await readFile(JSON_FILE, "utf8"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(XLSX_FILE);

  let written = 0;

  for (const sheet of workbook.worksheets) {
    const headerRow = sheet.getRow(1).values;
    const ci = {};
    for (let c = 1; c < headerRow.length; c++) {
      if (headerRow[c]) ci[String(headerRow[c]).trim()] = c;
    }
    const iEntry = ci["entry_id"];
    const iField = ci["field_id"];
    const iCn    = ci["cn_value"];
    if (!iEntry || !iField || !iCn) continue;

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const entryId = String(row.getCell(iEntry).value || "").trim();
      const fieldId = String(row.getCell(iField).value || "").trim();
      if (!entryId || !fieldId) return;
      const cnValue = snapshot[entryId]?.[fieldId];
      if (cnValue) {
        row.getCell(iCn).value = cnValue;
        written++;
      }
    });
  }

  await workbook.xlsx.writeFile(XLSX_FILE);
  console.log(`Restored ${written} translations into ${XLSX_FILE}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (process.argv.includes("--restore")) {
  await restore().catch(err => { console.error(err.message); process.exit(1); });
} else {
  await save().catch(err => { console.error(err.message); process.exit(1); });
}
