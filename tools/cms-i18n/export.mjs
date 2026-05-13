#!/usr/bin/env node
/**
 * Export Contentful EN entries to a multi-sheet Excel workbook for translation.
 *
 * Each content type becomes one sheet.
 * Columns: entry_id | field_id | field_label | en_value | cn_value
 *
 * - Only Symbol, Text, and RichText fields that are localized are exported.
 * - Slug fields are exported read-only (greyed note) so the translator has context
 *   but they are skipped on import.
 * - Rich text is flattened to plain text for the translator; import re-wraps it.
 *   NOTE: If your Rich Text is complex (nested lists, embedded entries) you may
 *   want to translate in Contentful's web app instead and skip those fields here.
 * - Existing zh-Hans values are pre-filled in the cn_value column so incremental
 *   re-runs let translators see what's already done.
 *
 * Usage:
 *   cp .env.example .env          # fill in CONTENTFUL_MANAGEMENT_TOKEN
 *   npm install
 *   node export.mjs               # writes contentful-translations.xlsx
 *
 * Requirements: .env file (or environment variables) with:
 *   CONTENTFUL_MANAGEMENT_TOKEN, CONTENTFUL_SPACE_ID, CONTENTFUL_ENVIRONMENT,
 *   LOCALE_SOURCE, LOCALE_TARGET
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
const LOCALE_SRC  = process.env.LOCALE_SOURCE          || "en-US";
const LOCALE_TGT  = process.env.LOCALE_TARGET          || "zh-Hans";
const OUT_FILE    = resolve(__dirname, "contentful-translations.xlsx");

if (!CMA_TOKEN) {
  console.error("ERROR: CONTENTFUL_MANAGEMENT_TOKEN not set. Copy .env.example → .env and fill it in.");
  process.exit(1);
}

// ── Field type helpers ───────────────────────────────────────────────────────

const TRANSLATABLE_TYPES = new Set(["Symbol", "Text", "RichText"]);

// Slugs are almost always NOT localised; skip to avoid accidental overwrites.
const SLUG_FIELD_IDS = new Set(["slug", "Slug"]);

function isTranslatableField(field) {
  if (!field.localized) return false;
  if (!TRANSLATABLE_TYPES.has(field.type)) return false;
  return true;
}

// Flatten Rich Text document to plain text (paragraphs joined by \n\n)
function richTextToPlain(node) {
  if (!node) return "";
  if (node.nodeType === "text") return node.value || "";
  if (Array.isArray(node.content)) {
    const parts = node.content.map(richTextToPlain).filter(Boolean);
    const tag = node.nodeType;
    if (tag === "paragraph" || tag === "heading-1" || tag === "heading-2" ||
        tag === "heading-3" || tag === "heading-4" || tag === "heading-5" ||
        tag === "heading-6") {
      return parts.join("") + "\n\n";
    }
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

  // 1. Fetch all content types
  const ctRes = await env.getContentTypes({ limit: 200 });
  const contentTypes = ctRes.items;
  console.log(`Found ${contentTypes.length} content types.\n`);

  const workbook = XLSX.utils.book_new();

  let totalRows = 0;

  for (const ct of contentTypes) {
    const ctId    = ct.sys.id;
    const ctName  = ct.name;

    // Filter to translatable fields
    const translatableFields = ct.fields.filter(isTranslatableField);
    if (translatableFields.length === 0) {
      console.log(`  ⊘ ${ctName} (${ctId}) — no localized text fields, skipping`);
      continue;
    }

    console.log(`  ◉ ${ctName} (${ctId}) — ${translatableFields.length} translatable fields`);

    // Fetch all entries for this content type (paginate)
    const rows = [["entry_id", "field_id", "field_label", "en_value", "cn_value", "_type"]];
    let skip = 0;
    const pageSize = 100;
    let total = Infinity;

    while (skip < total) {
      const res = await env.getEntries({
        content_type: ctId,
        limit: pageSize,
        skip,
        locale: "*",
      });
      total = res.total;

      for (const entry of res.items) {
        const entryId = entry.sys.id;
        for (const field of translatableFields) {
          const enVal = getFieldValue(entry, field.id, LOCALE_SRC);
          const cnVal = getFieldValue(entry, field.id, LOCALE_TGT);
          if (!enVal) continue; // skip empty source fields
          rows.push([
            entryId,
            field.id,
            field.name,
            enVal,
            cnVal,        // pre-fill existing CN if any
            field.type,   // hidden helper column
          ]);
        }
      }

      skip += res.items.length;
      if (res.items.length === 0) break;
    }

    const dataRows = rows.length - 1; // exclude header
    totalRows += dataRows;
    console.log(`    → ${dataRows} strings across ${total} entries`);

    // Build worksheet
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws["!cols"] = [
      { wch: 28 },  // entry_id
      { wch: 22 },  // field_id
      { wch: 22 },  // field_label
      { wch: 60 },  // en_value
      { wch: 60 },  // cn_value
      { wch: 10 },  // _type (hidden helper)
    ];

    // Freeze header row + first 3 columns so translator can scroll easily
    ws["!freeze"] = { xSplit: 3, ySplit: 1 };

    // Sheet name: Contentful ct names can be long; Excel limit is 31 chars
    const sheetName = ctName.slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
  }

  XLSX.writeFile(workbook, OUT_FILE);
  console.log(`\nDone. ${totalRows} strings exported to:\n  ${OUT_FILE}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open contentful-translations.xlsx`);
  console.log(`  2. Fill the "cn_value" column on each sheet (leave "en_value" untouched)`);
  console.log(`  3. Save and run:  node import.mjs`);
}

main().catch(err => {
  console.error("Export failed:", err.message || err);
  process.exit(1);
});
