#!/usr/bin/env node
/**
 * Build cn/*.html from en/*.html + i18n/cn/*.json translations.
 *
 * For each en/*.html file:
 *   1. Re-walk in identical order to extract.mjs (same skip rules, same attribute set).
 *   2. For each extracted string, look up cn translation by sequential ID.
 *   3. Replace text node / attribute / meta value in DOM.
 *   4. Update <html lang="en"> → <html lang="zh-Hans">.
 *   5. Rewrite internal links so navigation stays in cn locale (../../en/ → ../../cn/, /en/ → /cn/).
 *   6. Update language switcher (#lnkLangOpt) href to point back to en.
 *   7. Write to cn/<same-relative-path>.html
 *
 * If a translation is missing (cn === ""), the English original is kept and a warning is logged.
 *
 * Usage: cd tools/i18n && node build.mjs
 */

import * as cheerio from "cheerio";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const EN_DIR = join(REPO_ROOT, "en");
const CN_OUT_DIR = join(REPO_ROOT, "cn");
const TRANSLATIONS_DIR = join(REPO_ROOT, "i18n", "cn");
const TARGET_LANG = "zh-Hans";

const IGNORE_PATTERNS = [
  /job-listings2\.html$/,
  /product-finder \(2\)\.html$/,
  /product-finder \(3\)\.html$/,
  /style-guide-/,
];

const SKIP_EXACT = new Set([
  "ioi", "ioi oleochemical", "ioi oleochemical industries berhad",
  "ioi acidchem", "ioi acidchem sdn. bhd.",
  "ioi esterchem", "ioi esterchem (m) sdn. bhd.",
  "ioi pan-century", "ioi pan-century edible oils sdn. bhd.", "ioi pan-century oleochemicals sdn. bhd.",
  "palmac", "palmsurf", "palmsabun",
].map(s => s.toLowerCase()));

const SKIP_REGEX = [
  /^[\s ]*$/,
  /^[0-9\s.,()+-]+$/,
  /^[a-z]$/i,
  /^https?:\/\//i,
  /^[\w.+-]+@[\w-]+\.[\w.-]+$/,
  /^©.*all rights reserved/i,
];

const TRANSLATABLE_ATTRS = ["alt", "title", "placeholder", "aria-label", "data-wait"];
const META_NAMES_TO_TRANSLATE = new Set(["description", "twitter:title", "twitter:description"]);
const META_PROPS_TO_TRANSLATE = new Set(["og:title", "og:description"]);
const SKIP_TAGS = new Set(["script", "style", "noscript"]);

function shouldSkipString(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (SKIP_EXACT.has(trimmed.toLowerCase())) return true;
  for (const re of SKIP_REGEX) if (re.test(trimmed)) return true;
  return false;
}

function isDynamicElement($, el) {
  const attrs = el.attribs || {};
  if (
    "data-cms" in attrs ||
    "data-cms-template" in attrs ||
    "data-cms-list" in attrs ||
    "data-cms-href" in attrs ||
    "data-cms-src" in attrs
  ) return true;
  if ($(el).hasClass("w-dyn-bind-empty")) return true;
  return false;
}

// Build translation lookup from JSON; returns function(seqId) → cn or null
function makeLookup(jsonPayload) {
  const map = new Map();
  for (const s of jsonPayload.strings || []) {
    map.set(s.id, { en: s.en, cn: s.cn || "" });
  }
  return (id) => map.get(id);
}

// Walk, but instead of extracting, REPLACE in place using the lookup.
// IDs are assigned in the same order as extract.mjs.
function walkAndReplace($, el, lookup, idCounter, stats) {
  if (!el) return;
  if (el.type === "text") {
    const txt = el.data;
    if (!shouldSkipString(txt)) {
      const id = `t${++idCounter.value}`;
      const entry = lookup(id);
      if (entry && entry.cn) {
        // Preserve leading/trailing whitespace from original text node
        const leading = txt.match(/^\s*/)[0];
        const trailing = txt.match(/\s*$/)[0];
        el.data = leading + entry.cn + trailing;
        stats.translated++;
      } else {
        stats.missing.push({ id, en: txt.trim().slice(0, 60) });
      }
    }
    return;
  }
  if (el.type !== "tag") return;
  if (SKIP_TAGS.has(el.name)) return;
  if (isDynamicElement($, el)) return;

  for (const attr of TRANSLATABLE_ATTRS) {
    if (el.attribs && attr in el.attribs) {
      const val = el.attribs[attr];
      if (!shouldSkipString(val)) {
        const id = `t${++idCounter.value}`;
        const entry = lookup(id);
        if (entry && entry.cn) {
          el.attribs[attr] = entry.cn;
          stats.translated++;
        } else {
          stats.missing.push({ id, en: val.slice(0, 60) });
        }
      }
    }
  }

  if (el.children) {
    for (const child of el.children) {
      walkAndReplace($, child, lookup, idCounter, stats);
    }
  }
}

function replaceMetaAndTitle($, lookup, idCounter, stats) {
  // <title>
  const $title = $("head > title").first();
  if ($title.length) {
    const txt = $title.text();
    if (!shouldSkipString(txt)) {
      const id = `t${++idCounter.value}`;
      const entry = lookup(id);
      if (entry && entry.cn) {
        $title.text(entry.cn);
        stats.translated++;
      } else {
        stats.missing.push({ id, en: txt.trim().slice(0, 60) });
      }
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
        const id = `t${++idCounter.value}`;
        const entry = lookup(id);
        if (entry && entry.cn) {
          el.attribs.content = entry.cn;
          stats.translated++;
        } else {
          stats.missing.push({ id, en: content.slice(0, 60) });
        }
      }
    }
  });
}

// Rewrite internal links to keep navigation inside cn locale.
// Skips the language switcher (#lnkLangOpt) — that one flips to en.
function rewriteInternalLinks($) {
  $("a[href], link[href]").each((_, el) => {
    const href = el.attribs?.href;
    if (!href) return;
    // Skip absolute external URLs, anchors, mailto, tel
    if (/^(https?:|mailto:|tel:|#|javascript:|data:)/i.test(href)) return;
    if (el.attribs.id === "lnkLangOpt") {
      // Reverse direction: cn page's switcher points to en
      el.attribs.href = href.replace(/(\.\.\/)*cn\//, m => m.replace("cn/", "en/"))
                             .replace(/^\/cn\//, "/en/");
      return;
    }
    // Rewrite ../../en/ → ../../cn/, /en/ → /cn/
    let newHref = href;
    newHref = newHref.replace(/(\.\.\/)+en\//g, (m) => m.replace("en/", "cn/"));
    newHref = newHref.replace(/^\/en\//, "/cn/");
    if (newHref !== href) el.attribs.href = newHref;
  });
}

// Some pages reference assets / scripts via relative paths like "../../js/..." — these don't change.
// But the language switcher in subIndexTop.js etc. may need adjustment too. For now, leave assets alone.

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

async function buildFile(absPath) {
  const rel = relative(REPO_ROOT, absPath);             // en/about-us/job-listings.html
  const relWithoutEn = rel.replace(/^en\//, "");        // about-us/job-listings.html
  const jsonPath = join(TRANSLATIONS_DIR, relWithoutEn.replace(/\.html$/, ".json"));
  const outPath = join(CN_OUT_DIR, relWithoutEn);

  if (!existsSync(jsonPath)) {
    return { rel, status: "skipped", reason: "no translation file", outPath };
  }

  const jsonPayload = JSON.parse(await readFile(jsonPath, "utf8"));
  const hasAnyTranslations = (jsonPayload.strings || []).some(s => s.cn && s.cn.trim());
  if (!hasAnyTranslations) {
    return { rel, status: "skipped", reason: "no translations filled in yet", outPath };
  }
  const lookup = makeLookup(jsonPayload);
  const html = await readFile(absPath, "utf8");
  const $ = cheerio.load(html, { decodeEntities: false });

  const stats = { translated: 0, missing: [] };
  const idCounter = { value: 0 };

  // 1. Replace title + meta
  replaceMetaAndTitle($, lookup, idCounter, stats);

  // 2. Walk body
  const body = $("body").get(0);
  if (body) walkAndReplace($, body, lookup, idCounter, stats);

  // 3. Update <html lang>
  $("html").attr("lang", TARGET_LANG);

  // 4. Rewrite internal links
  rewriteInternalLinks($);

  // 5. Write output
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, $.html(), "utf8");

  return { rel, outPath, stats };
}

async function main() {
  const files = await findHtmlFiles(EN_DIR);
  console.log(`Building ${files.length} cn/ pages from en/ + i18n/cn/...\n`);

  let totalTranslated = 0, totalMissing = 0;
  const skipped = [];

  for (const f of files) {
    const result = await buildFile(f);
    if (result.status === "skipped") {
      skipped.push(result);
      console.log(`  ⊘ ${result.rel}  (${result.reason})`);
      continue;
    }
    const { rel, outPath, stats } = result;
    const cnRel = relative(REPO_ROOT, outPath);
    const missingCount = stats.missing.length;
    totalTranslated += stats.translated;
    totalMissing += missingCount;
    const note = missingCount ? `  ⚠ ${missingCount} missing translations` : "";
    console.log(`  ✓ ${rel} → ${cnRel}  (${stats.translated} replaced)${note}`);
  }

  console.log(`\nTotal: ${totalTranslated} translated, ${totalMissing} missing across ${files.length} files.`);
  if (skipped.length) console.log(`Skipped (no translation file): ${skipped.length}`);
}

main().catch(err => {
  console.error("Build failed:", err);
  process.exit(1);
});
