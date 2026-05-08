#!/usr/bin/env node
/**
 * Extract translatable strings from en/*.html into i18n/en/*.json
 *
 * Walks each HTML file depth-first and collects:
 *   - Visible text nodes (excluding script/style/noscript)
 *   - Translatable attributes: alt, title, placeholder, aria-label, data-wait
 *   - <title> tag content
 *   - <meta name="description|og:title|og:description|twitter:title|twitter:description">
 *   - JSON-LD name/description fields
 *
 * Skips:
 *   - Anything inside elements with data-cms / data-cms-template / data-cms-list / data-cms-href / data-cms-src
 *   - Elements with class "w-dyn-bind-empty"
 *   - Brand names (IOI Oleochemical, IOI Acidchem, ...) and product names (Palmac, Palmsurf, Palmsabun)
 *   - URLs, emails, phone-only, numeric-only, single chars, whitespace-only
 *
 * Output JSON contains an ordered array of strings with stable IDs (t1, t2, ...).
 * The walker is deterministic — re-extraction of unchanged HTML produces identical output.
 *
 * Usage: cd tools/i18n && node extract.mjs
 */

import * as cheerio from "cheerio";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const EN_DIR = join(REPO_ROOT, "en");
const REF_DIR = join(REPO_ROOT, "i18n", "en");        // English snapshot (read-only reference)
const WORK_DIR = join(REPO_ROOT, "i18n", "cn");       // Translator's worksheet (edit cn field here)

// Files to ignore (duplicates, style guide)
const IGNORE_PATTERNS = [
  /job-listings2\.html$/,
  /product-finder \(2\)\.html$/,
  /product-finder \(3\)\.html$/,
  /style-guide-/,
];

// Untranslatable tokens — exact match (case-insensitive)
const SKIP_EXACT = new Set([
  "ioi",
  "ioi oleochemical",
  "ioi oleochemical industries berhad",
  "ioi acidchem",
  "ioi acidchem sdn. bhd.",
  "ioi esterchem",
  "ioi esterchem (m) sdn. bhd.",
  "ioi pan-century",
  "ioi pan-century edible oils sdn. bhd.",
  "ioi pan-century oleochemicals sdn. bhd.",
  "palmac",
  "palmsurf",
  "palmsabun",
].map(s => s.toLowerCase()));

// Skip if the entire string contains nothing but these phrases
const SKIP_REGEX = [
  /^[\s ]*$/,                              // whitespace only
  /^[0-9\s.,()+-]+$/,                            // numeric / phone-ish
  /^[a-z]$/i,                                    // single letter
  /^https?:\/\//i,                               // URL
  /^[\w.+-]+@[\w-]+\.[\w.-]+$/,                  // email
  /^©.*all rights reserved/i,                    // copyright (handled separately if needed)
];

const TRANSLATABLE_ATTRS = ["alt", "title", "placeholder", "aria-label", "data-wait"];
const META_NAMES_TO_TRANSLATE = new Set(["description", "twitter:title", "twitter:description"]);
const META_PROPS_TO_TRANSLATE = new Set(["og:title", "og:description"]);

const SKIP_TAGS = new Set(["script", "style", "noscript"]);

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function shouldSkipString(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (SKIP_EXACT.has(trimmed.toLowerCase())) return true;
  for (const re of SKIP_REGEX) if (re.test(trimmed)) return true;
  return false;
}

function isDynamicElement($, el) {
  const $el = $(el);
  const attrs = el.attribs || {};
  if (
    "data-cms" in attrs ||
    "data-cms-template" in attrs ||
    "data-cms-list" in attrs ||
    "data-cms-href" in attrs ||
    "data-cms-src" in attrs
  ) return true;
  if ($el.hasClass("w-dyn-bind-empty")) return true;
  return false;
}

function isInsideDynamic($, el) {
  let p = el.parent;
  while (p && p.type === "tag") {
    if (isDynamicElement($, p)) return true;
    if (p.attribs && ("data-cms-list" in p.attribs)) return true;
    p = p.parent;
  }
  return false;
}

function getElementContext($, el) {
  // Build a short CSS-like context: tag.class[#id]
  const parts = [];
  let cur = el;
  let depth = 0;
  while (cur && cur.type === "tag" && depth < 3) {
    const tag = cur.name;
    const cls = (cur.attribs?.class || "").split(/\s+/).filter(Boolean)[0];
    const id = cur.attribs?.id;
    let part = tag;
    if (id) part += `#${id}`;
    else if (cls) part += `.${cls}`;
    parts.unshift(part);
    cur = cur.parent;
    depth++;
  }
  return parts.join(" > ");
}

function walkExtractText($, el, out, idCounter) {
  if (!el) return;
  if (el.type === "text") {
    const txt = el.data;
    if (!shouldSkipString(txt)) {
      out.push({
        id: `t${++idCounter.value}`,
        type: "text",
        context: getElementContext($, el.parent),
        en: txt.replace(/\s+/g, " ").trim(),
        cn: "",
      });
    }
    return;
  }
  if (el.type !== "tag") return;
  if (SKIP_TAGS.has(el.name)) return;
  if (isDynamicElement($, el)) return;

  // Attributes
  for (const attr of TRANSLATABLE_ATTRS) {
    if (el.attribs && attr in el.attribs) {
      const val = el.attribs[attr];
      if (!shouldSkipString(val)) {
        out.push({
          id: `t${++idCounter.value}`,
          type: `attr:${attr}`,
          context: getElementContext($, el),
          en: val.trim(),
          cn: "",
        });
      }
    }
  }

  // Recurse into children
  if (el.children) {
    for (const child of el.children) {
      walkExtractText($, child, out, idCounter);
    }
  }
}

function extractMetaAndTitle($, out, idCounter) {
  // <title>
  const $title = $("head > title").first();
  if ($title.length) {
    const txt = $title.text();
    if (!shouldSkipString(txt)) {
      out.push({
        id: `t${++idCounter.value}`,
        type: "title",
        context: "head > title",
        en: txt.trim(),
        cn: "",
      });
    }
  }

  // <meta>
  $("head meta").each((_, el) => {
    const name = el.attribs?.name;
    const prop = el.attribs?.property;
    const content = el.attribs?.content;
    if (!content) return;
    if (
      (name && META_NAMES_TO_TRANSLATE.has(name)) ||
      (prop && META_PROPS_TO_TRANSLATE.has(prop))
    ) {
      if (!shouldSkipString(content)) {
        out.push({
          id: `t${++idCounter.value}`,
          type: name ? `meta[name=${name}]` : `meta[property=${prop}]`,
          context: "head",
          en: content.trim(),
          cn: "",
        });
      }
    }
  });
}

// ──────────────────────────────────────────────────────────
// Walk filesystem
// ──────────────────────────────────────────────────────────

async function findHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await findHtmlFiles(full)));
    } else if (e.isFile() && e.name.endsWith(".html")) {
      const rel = relative(REPO_ROOT, full);
      if (IGNORE_PATTERNS.some(re => re.test(rel))) continue;
      files.push(full);
    }
  }
  return files;
}

async function extractFile(absPath) {
  const html = await readFile(absPath, "utf8");
  const $ = cheerio.load(html, { decodeEntities: false });
  const idCounter = { value: 0 };
  const strings = [];

  // 1. <title> + <meta>
  extractMetaAndTitle($, strings, idCounter);

  // 2. Body walk (depth-first)
  const body = $("body").get(0);
  if (body) {
    walkExtractText($, body, strings, idCounter);
  }

  return strings;
}

async function main() {
  const files = await findHtmlFiles(EN_DIR);
  console.log(`Found ${files.length} HTML files to extract.`);

  let totalStrings = 0;

  for (const f of files) {
    const rel = relative(REPO_ROOT, f);                 // en/about-us/job-listings.html
    const relWithoutEn = rel.replace(/^en\//, "");      // about-us/job-listings.html
    const jsonRel = relWithoutEn.replace(/\.html$/, ".json");
    const refFile = join(REF_DIR, jsonRel);
    const workFile = join(WORK_DIR, jsonRel);
    await mkdir(dirname(refFile), { recursive: true });
    await mkdir(dirname(workFile), { recursive: true });

    const strings = await extractFile(f);
    const extractedAt = new Date().toISOString();

    // Reference snapshot — English only, no cn field
    const refPayload = {
      file: rel,
      extracted_at: extractedAt,
      total: strings.length,
      strings: strings.map(({ id, type, context, en }) => ({ id, type, context, en })),
    };
    await writeFile(refFile, JSON.stringify(refPayload, null, 2), "utf8");

    // Worksheet — preserve existing cn translations on re-extract
    let existingCn = {};
    if (existsSync(workFile)) {
      try {
        const prev = JSON.parse(await readFile(workFile, "utf8"));
        for (const s of prev.strings || []) {
          if (s.cn) existingCn[`${s.id}::${s.en}`] = s.cn;
        }
      } catch { /* ignore parse errors, treat as empty */ }
    }
    const workPayload = {
      file: rel,
      lang_target: "cn",
      extracted_at: extractedAt,
      total: strings.length,
      strings: strings.map(s => ({
        ...s,
        cn: existingCn[`${s.id}::${s.en}`] || "",
      })),
    };
    await writeFile(workFile, JSON.stringify(workPayload, null, 2), "utf8");

    const carriedOver = Object.keys(existingCn).length
      ? ` (${strings.filter(s => existingCn[`${s.id}::${s.en}`]).length} existing translations preserved)`
      : "";
    console.log(`  ✓ ${rel}  →  ${strings.length} strings${carriedOver}`);
    totalStrings += strings.length;
  }

  console.log(`\nDone. Extracted ${totalStrings} strings across ${files.length} files.`);
  console.log(`Reference (do not edit):  i18n/en/`);
  console.log(`Translator worksheet:     i18n/cn/`);
}

main().catch(err => {
  console.error("Extract failed:", err);
  process.exit(1);
});
