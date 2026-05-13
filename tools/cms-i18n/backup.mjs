#!/usr/bin/env node
/**
 * Backup / Restore zh-Hans values before an import run.
 *
 * Usage:
 *   node backup.mjs             # save current zh-Hans values → zh-hans-backup.json
 *   node backup.mjs --restore   # write saved values back to Contentful
 *
 * Run backup BEFORE node import.mjs so you have a clean restore point.
 */

import contentfulManagement from "contentful-management";
const { createClient } = contentfulManagement;
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const CMA_TOKEN   = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const SPACE_ID    = process.env.CONTENTFUL_SPACE_ID    || "slmipam661bk";
const ENVIRONMENT = process.env.CONTENTFUL_ENVIRONMENT || "master";
const LOCALE_TGT  = process.env.LOCALE_TARGET          || "zh-Hans";
const IN_FILE     = resolve(__dirname, "contentful-translations.xlsx");
const BACKUP_FILE = resolve(__dirname, "zh-hans-backup.json");

if (!CMA_TOKEN) {
  console.error("ERROR: CONTENTFUL_MANAGEMENT_TOKEN not set.");
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Collect entry IDs from the xlsx ──────────────────────────────────────────

async function getEntryIds() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(IN_FILE);
  const ids = new Set();
  for (const sheet of workbook.worksheets) {
    const headerRow = sheet.getRow(1).values;
    const colIndex = {};
    for (let c = 1; c < headerRow.length; c++) {
      if (headerRow[c]) colIndex[String(headerRow[c]).trim()] = c;
    }
    const iEntry = colIndex["entry_id"];
    if (!iEntry) continue;
    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const id = String(row.getCell(iEntry).value || "").trim();
      if (id) ids.add(id);
    });
  }
  return [...ids];
}

// ── Backup ────────────────────────────────────────────────────────────────────

async function backup() {
  console.log(`Reading entry IDs from ${IN_FILE}…`);
  const entryIds = await getEntryIds();
  console.log(`Found ${entryIds.length} unique entries. Fetching zh-Hans values from Contentful…\n`);

  const client = createClient({ accessToken: CMA_TOKEN });
  const space  = await client.getSpace(SPACE_ID);
  const env    = await space.getEnvironment(ENVIRONMENT);

  const snapshot = {};

  for (let i = 0; i < entryIds.length; i++) {
    const id = entryIds[i];
    try {
      const entry = await env.getEntry(id);
      const zhFields = {};
      for (const [fieldId, locales] of Object.entries(entry.fields)) {
        if (locales[LOCALE_TGT] !== undefined) {
          zhFields[fieldId] = locales[LOCALE_TGT];
        }
      }
      snapshot[id] = {
        sys: { version: entry.sys.version, publishedVersion: entry.sys.publishedVersion },
        fields: zhFields,
      };
      process.stdout.write(`  [${i+1}/${entryIds.length}] ${id}\r`);
    } catch (err) {
      console.warn(`\n  ⚠ ${id}: ${err.message}`);
    }
    if (i % 5 === 4) await sleep(250);
  }

  await writeFile(BACKUP_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`\n\nBackup saved → ${BACKUP_FILE}`);
  console.log(`  ${Object.keys(snapshot).length} entries, locale: ${LOCALE_TGT}`);
  console.log(`\nRun node import.mjs when ready. Restore with: node backup.mjs --restore`);
}

// ── Restore ───────────────────────────────────────────────────────────────────

async function restore() {
  if (!existsSync(BACKUP_FILE)) {
    console.error(`ERROR: ${BACKUP_FILE} not found. Run backup first.`);
    process.exit(1);
  }

  const snapshot = JSON.parse(await readFile(BACKUP_FILE, "utf8"));
  const entryIds = Object.keys(snapshot);
  console.log(`Restoring ${entryIds.length} entries to ${LOCALE_TGT} values from backup…\n`);

  const client = createClient({ accessToken: CMA_TOKEN });
  const space  = await client.getSpace(SPACE_ID);
  const env    = await space.getEnvironment(ENVIRONMENT);

  let restored = 0, skipped = 0, errors = 0;

  for (let i = 0; i < entryIds.length; i++) {
    const id = entryIds[i];
    const saved = snapshot[id];
    try {
      const entry = await env.getEntry(id);
      let changed = false;

      for (const [fieldId, savedValue] of Object.entries(saved.fields)) {
        if (!entry.fields[fieldId]) continue;
        const current = entry.fields[fieldId][LOCALE_TGT];
        // Simple equality check (works for strings; rich text compares by reference)
        if (JSON.stringify(current) !== JSON.stringify(savedValue)) {
          entry.fields[fieldId][LOCALE_TGT] = savedValue;
          changed = true;
        }
      }

      if (!changed) { skipped++; continue; }

      const wasPublished = !!saved.sys.publishedVersion;
      const updated = await entry.update();
      if (wasPublished) await updated.publish();

      restored++;
      console.log(`  ✓ [${i+1}/${entryIds.length}] ${id}`);
    } catch (err) {
      errors++;
      console.error(`  ✗ ${id}: ${err.message}`);
    }
    if (i % 5 === 4) await sleep(250);
  }

  console.log(`\nRestore complete.`);
  console.log(`  Restored: ${restored}`);
  console.log(`  Skipped (already matched backup): ${skipped}`);
  console.log(`  Errors:   ${errors}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (process.argv.includes("--restore")) {
  await restore().catch(err => { console.error(err.message); process.exit(1); });
} else {
  await backup().catch(err => { console.error(err.message); process.exit(1); });
}
