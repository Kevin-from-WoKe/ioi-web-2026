#!/usr/bin/env node
/**
 * Import CN translations from Excel back into Contentful as zh-Hans locale values.
 *
 * Reads every sheet in contentful-translations.xlsx.
 * For each row where cn_value is non-empty:
 *   - Fetches the entry from Contentful
 *   - Sets entry.fields[field_id]["zh-Hans"] = cn_value
 *   - Publishes the entry if it was previously published
 *
 * Safe to re-run: entries are only patched if cn_value differs from what's already
 * in Contentful. Dry-run mode (--dry) prints what would change without writing.
 *
 * Rich Text caveat: CN values are wrapped in a minimal Rich Text document (single
 * paragraph). For complex rich text translate those fields directly in Contentful.
 *
 * Usage:
 *   node import.mjs                     # write mode
 *   node import.mjs --dry               # dry-run (no writes)
 *   node import.mjs --sheet "CSR Event" # only process one sheet
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
const LOCALE_TGT  = process.env.LOCALE_TARGET          || "zh-Hans";
const IN_FILE     = resolve(__dirname, "contentful-translations.xlsx");

const DRY_RUN    = process.argv.includes("--dry");
const SHEET_ONLY = (() => {
  const idx = process.argv.indexOf("--sheet");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

if (!CMA_TOKEN) {
  console.error("ERROR: CONTENTFUL_MANAGEMENT_TOKEN not set. Copy .env.example → .env and fill it in.");
  process.exit(1);
}

if (!existsSync(IN_FILE)) {
  console.error(`ERROR: ${IN_FILE} not found. Run export.mjs first.`);
  process.exit(1);
}

// ── Rich Text wrapper ────────────────────────────────────────────────────────

function plainToRichText(text) {
  const paragraphs = text.split(/\n{2,}/);
  return {
    nodeType: "document",
    data: {},
    content: paragraphs.map(para => ({
      nodeType: "paragraph",
      data: {},
      content: para.split("\n").flatMap((line, i, arr) => {
        const nodes = [{ nodeType: "text", value: line, marks: [], data: {} }];
        if (i < arr.length - 1) nodes.push({ nodeType: "text", value: "\n", marks: [], data: {} });
        return nodes;
      }),
    })),
  };
}

// ── Read workbook ─────────────────────────────────────────────────────────────

// Returns Map<entryId, Map<fieldId, { cnValue, type }>>
async function readWorkbook() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(IN_FILE);

  const data = new Map();

  for (const sheet of workbook.worksheets) {
    if (SHEET_ONLY && sheet.name !== SHEET_ONLY) continue;

    // Row 1 is the header
    const headerRow = sheet.getRow(1).values; // 1-indexed, index 0 is undefined
    const colIndex = {};
    for (let c = 1; c < headerRow.length; c++) {
      if (headerRow[c]) colIndex[String(headerRow[c]).trim()] = c;
    }

    const iEntry = colIndex["entry_id"];
    const iField = colIndex["field_id"];
    const iCn    = colIndex["cn_value"];
    const iType  = colIndex["_type"];

    if (!iEntry || !iField || !iCn) {
      console.warn(`  ⚠ Sheet "${sheet.name}" missing expected columns, skipping.`);
      continue;
    }

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header
      const entryId = String(row.getCell(iEntry).value || "").trim();
      const fieldId = String(row.getCell(iField).value || "").trim();
      const cnValue = String(row.getCell(iCn).value    || "").trim();
      const type    = iType ? String(row.getCell(iType).value || "Symbol").trim() : "Symbol";

      if (!entryId || !fieldId || !cnValue) return;

      if (!data.has(entryId)) data.set(entryId, new Map());
      data.get(entryId).set(fieldId, { cnValue, type });
    });
  }

  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN)    console.log("DRY RUN — no changes will be written.\n");
  if (SHEET_ONLY) console.log(`Processing sheet: "${SHEET_ONLY}" only.\n`);

  console.log(`Reading ${IN_FILE}…`);
  const translations = await readWorkbook();
  console.log(`Found ${translations.size} entries with CN translations.\n`);

  if (translations.size === 0) {
    console.log("Nothing to import. Fill in the cn_value column in the Excel file first.");
    return;
  }

  const client = createClient({ accessToken: CMA_TOKEN });
  const space  = await client.getSpace(SPACE_ID);
  const env    = await space.getEnvironment(ENVIRONMENT);

  let patched = 0, skipped = 0, errors = 0;
  const entryIds = [...translations.keys()];

  console.log(`Importing ${entryIds.length} entries into Contentful (locale: ${LOCALE_TGT})…\n`);

  for (let i = 0; i < entryIds.length; i++) {
    const entryId = entryIds[i];
    const fields  = translations.get(entryId);

    try {
      const entry = await env.getEntry(entryId);
      let changed = false;

      for (const [fieldId, { cnValue, type }] of fields) {
        const currentCn = (() => {
          const f = entry.fields[fieldId];
          if (!f) return "";
          const v = f[LOCALE_TGT];
          if (v === undefined || v === null) return "";
          if (typeof v === "object" && v.nodeType === "document") {
            return v.content?.map(n => n.content?.map(t => t.value || "").join("") || "").join(" ").trim() || "";
          }
          return String(v).trim();
        })();

        if (currentCn === cnValue) continue; // already up to date

        if (!entry.fields[fieldId]) {
          console.warn(`    ⚠ Field ${fieldId} not found on entry ${entryId}, skipping.`);
          continue;
        }

        const valueToSet = type === "RichText" ? plainToRichText(cnValue) : cnValue;
        entry.fields[fieldId][LOCALE_TGT] = valueToSet;
        changed = true;
      }

      if (!changed) { skipped++; continue; }

      if (!DRY_RUN) {
        const wasPublished = !!entry.sys.publishedVersion;
        const updated = await entry.update();
        if (wasPublished) await updated.publish();
      }

      patched++;
      console.log(`  ✓ [${i + 1}/${entryIds.length}] ${entryId} (${fields.size} field(s))${DRY_RUN ? " [dry]" : ""}`);

    } catch (err) {
      errors++;
      console.error(`  ✗ ${entryId}: ${err.message || err}`);
    }

    // Throttle: ~5 req/s, well within CMA rate limit
    if (!DRY_RUN && i % 5 === 4) await sleep(250);
  }

  console.log(`\nDone.`);
  console.log(`  Patched:  ${patched}`);
  console.log(`  Skipped (already up to date): ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  if (DRY_RUN) console.log(`\nThis was a dry run. Re-run without --dry to apply changes.`);
}

main().catch(err => {
  console.error("Import failed:", err.message || err);
  process.exit(1);
});
