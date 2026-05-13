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
 * Safe to re-run: entries are only patched if the cn_value differs from what's
 * already in Contentful (skips no-op updates). Dry-run mode (--dry) prints what
 * would change without writing anything.
 *
 * Rich Text caveat: this script imports CN values as plain Symbol/Text.
 * If the original field type is RichText, the CN value is wrapped in a minimal
 * Rich Text document (single paragraph). For complex rich text (embedded entries,
 * tables, nested lists) you should translate those fields directly in Contentful.
 *
 * Usage:
 *   node import.mjs            # write mode
 *   node import.mjs --dry      # dry-run (no writes)
 *   node import.mjs --sheet "CSR Event"   # only process one sheet
 *
 * Requirements: same .env as export.mjs
 */

import contentfulManagement from "contentful-management";
const { createClient } = contentfulManagement;
import * as XLSX from "xlsx";
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

const DRY_RUN     = process.argv.includes("--dry");
const SHEET_ONLY  = (() => {
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

// Wrap a plain-text translation into a minimal Rich Text document.
// Paragraphs are split by double-newline; single newlines become line-breaks.
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
        if (i < arr.length - 1) {
          nodes.push({ nodeType: "text", value: "\n", marks: [], data: {} });
        }
        return nodes;
      }),
    })),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Read Excel → Map<entryId, Map<fieldId, { cnValue, type }>>
function readWorkbook() {
  const wb = XLSX.readFile(IN_FILE);
  const data = new Map(); // entryId → Map(fieldId → { cnValue, type })

  for (const sheetName of wb.SheetNames) {
    if (SHEET_ONLY && sheetName !== SHEET_ONLY) continue;

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // Expect header: entry_id | field_id | field_label | en_value | cn_value | _type
    if (rows.length < 2) continue;
    const [header, ...dataRows] = rows;
    const idxEntryId  = header.indexOf("entry_id");
    const idxFieldId  = header.indexOf("field_id");
    const idxCnValue  = header.indexOf("cn_value");
    const idxType     = header.indexOf("_type");

    if (idxEntryId < 0 || idxFieldId < 0 || idxCnValue < 0) {
      console.warn(`  ⚠ Sheet "${sheetName}" missing expected columns, skipping.`);
      continue;
    }

    for (const row of dataRows) {
      const entryId = String(row[idxEntryId] || "").trim();
      const fieldId = String(row[idxFieldId] || "").trim();
      const cnValue = String(row[idxCnValue] || "").trim();
      const type    = idxType >= 0 ? String(row[idxType] || "").trim() : "Symbol";

      if (!entryId || !fieldId || !cnValue) continue;

      if (!data.has(entryId)) data.set(entryId, new Map());
      data.get(entryId).set(fieldId, { cnValue, type });
    }
  }

  return data;
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

// Contentful CMA rate limit: 7 req/s for entry operations.
// We batch entry fetches and use a simple queue with a small delay.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log("DRY RUN — no changes will be written.\n");
  if (SHEET_ONLY) console.log(`Processing sheet: "${SHEET_ONLY}" only.\n`);

  console.log(`Reading ${IN_FILE}…`);
  const translations = readWorkbook();
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
        // Determine the current CN value
        const currentCn = (() => {
          const f = entry.fields[fieldId];
          if (!f) return "";
          const v = f[LOCALE_TGT];
          if (v === undefined || v === null) return "";
          if (typeof v === "object" && v.nodeType === "document") {
            // Flatten for comparison
            return v.content?.map(n => n.content?.map(t => t.value || "").join("") || "").join(" ").trim() || "";
          }
          return String(v).trim();
        })();

        if (currentCn === cnValue) {
          // Already up to date
          continue;
        }

        // Ensure field exists on entry
        if (!entry.fields[fieldId]) {
          console.warn(`    ⚠ Field ${fieldId} not found on entry ${entryId}, skipping field.`);
          continue;
        }

        // Set the CN value
        const valueToSet = type === "RichText" ? plainToRichText(cnValue) : cnValue;
        entry.fields[fieldId][LOCALE_TGT] = valueToSet;
        changed = true;
      }

      if (!changed) {
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        const wasPublished = !!entry.sys.publishedVersion;
        const updated = await entry.update();
        if (wasPublished) await updated.publish();
      }

      patched++;
      const label = `[${i + 1}/${entryIds.length}]`;
      console.log(`  ✓ ${label} ${entryId} (${fields.size} field(s))${DRY_RUN ? " [dry]" : ""}`);

    } catch (err) {
      errors++;
      console.error(`  ✗ ${entryId}: ${err.message || err}`);
    }

    // Throttle: ~5 req/s to stay well within CMA rate limit
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
