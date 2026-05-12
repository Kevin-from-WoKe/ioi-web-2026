#!/usr/bin/env node
/**
 * Export visible EN ↔ CN translations to an XLSX workbook for client review.
 *
 * Filters:
 *   - SKIP all SEO/hidden content: <title>, <meta>, alt, title, aria-label, data-wait
 *   - SKIP anything inside is-hidden / display:none ancestors (Webflow scaffold)
 *   - SKIP detail_* pages entirely (mostly meta-only after filtering)
 *
 * Includes:
 *   - All visible text nodes
 *   - placeholder attributes (visible in empty form fields)
 *
 * Output: tools/i18n/translation-review.xlsx — one tab per cluster.
 *
 * Usage: cd tools/i18n && node export-review.mjs
 */

import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const EN_DIR = join(REPO_ROOT, "en");
const CN_DIR = join(REPO_ROOT, "i18n", "cn");
const OUT_PATH = join(__dirname, "translation-review.xlsx");

const IGNORE_FILE_PATTERNS = [
  /job-listings2\.html$/,
  /product-finder \(2\)\.html$/,
  /product-finder \(3\)\.html$/,
  /style-guide-/,
  /^en\/detail_/,                       // user requested: skip detail pages
];

// Same skip rules as extract.mjs to keep walker order in sync
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

const SKIP_TAGS = new Set(["script", "style", "noscript"]);
// Note: walker still emits these for ID synchronization with cn JSON,
// but we filter them OUT of the export
const SEO_ATTRS_ALL = ["alt", "title", "placeholder", "aria-label", "data-wait"];
const VISIBLE_ATTRS = ["placeholder"];                          // visible to sighted users

function shouldSkipString(text) {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  if (SKIP_EXACT.has(t.toLowerCase())) return true;
  for (const re of SKIP_REGEX) if (re.test(t)) return true;
  return false;
}

function isDynamicElement($, el) {
  const a = el.attribs || {};
  if ("data-cms" in a || "data-cms-template" in a || "data-cms-list" in a ||
      "data-cms-href" in a || "data-cms-src" in a) return true;
  if ($(el).hasClass("w-dyn-bind-empty")) return true;
  return false;
}

function hasHiddenAncestor(el) {
  let p = el;
  while (p && p.type === "tag") {
    const a = p.attribs || {};
    const classes = (a.class || "").split(/\s+/);
    if (classes.includes("is-hidden")) return true;
    const style = (a.style || "").replace(/\s+/g, "");
    if (style.includes("display:none")) return true;
    p = p.parent;
  }
  return false;
}

// Determine the page section: nav / hero / body / footer / form
function sectionHint(el) {
  let p = el;
  while (p && p.type === "tag") {
    const cls = (p.attribs?.class || "").split(/\s+/);
    for (const c of cls) {
      if (c.startsWith("navbar5_") || c.startsWith("navbar14_") || c.startsWith("navbar")) return "Nav";
      if (c.startsWith("footer12_") || c.startsWith("footer")) return "Footer";
      if (c.startsWith("contact6_form") || c.startsWith("contact6_")) return "Form";
      if (c === "career4_list" || c === "career4_component") return "Job list";
      if (c.includes("header") && c.includes("_component")) return "Hero";
    }
    if (p.name === "form" || p.name === "input" || p.name === "select" || p.name === "textarea") return "Form";
    p = p.parent;
  }
  return "Body";
}

function classifyCluster(relPath) {
  // relPath like "en/about-us/job-listings.html"
  if (/^en\/40[14]\.html$/.test(relPath)) return "Utility";
  if (relPath === "en/index.html") return "Homepage";
  if (relPath.startsWith("en/about-us")) return "About Us";
  if (relPath.startsWith("en/sustainability")) return "Sustainability";
  if (relPath === "en/product-application.html" || relPath === "en/product-finder.html") return "Products";
  if (relPath.startsWith("en/downloads/")) return "Downloads";
  if (relPath === "en/enquiry.html") return "Forms";
  if (/^en\/(csr|disclaimer|pdpa)\.html$/.test(relPath)) return "Legal";
  return "Other";
}

const CLUSTER_ORDER = ["Utility", "Homepage", "About Us", "Sustainability", "Products", "Downloads", "Forms", "Legal", "Other"];

// ──────────────────────────────────────────────────────────
// Walk
// ──────────────────────────────────────────────────────────

async function findHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await findHtmlFiles(full)));
    } else if (e.isFile() && e.name.endsWith(".html")) {
      const rel = relative(REPO_ROOT, full);
      if (IGNORE_FILE_PATTERNS.some(re => re.test(rel))) continue;
      out.push(full);
    }
  }
  return out;
}

// Walk a page in the SAME order as extract.mjs so IDs match the JSON.
// Returns rows = [{ id, type, en, page, sectionHint, hidden }, ...]
function extractWithFilter($, body) {
  const rows = [];
  const idCounter = { value: 0 };

  // 1. <title> + <meta>  (ALWAYS emit to keep ID sync, but mark as SEO so we filter later)
  const $title = $("head > title").first();
  if ($title.length) {
    const txt = $title.text();
    if (!shouldSkipString(txt)) {
      rows.push({ id: `t${++idCounter.value}`, type: "title", en: txt.trim(), hidden: true, section: "SEO" });
    }
  }
  $("head meta").each((_, el) => {
    const name = el.attribs?.name;
    const prop = el.attribs?.property;
    const content = el.attribs?.content;
    if (!content) return;
    const META_NAMES = new Set(["description", "twitter:title", "twitter:description"]);
    const META_PROPS = new Set(["og:title", "og:description"]);
    if ((name && META_NAMES.has(name)) || (prop && META_PROPS.has(prop))) {
      if (!shouldSkipString(content)) {
        rows.push({ id: `t${++idCounter.value}`, type: name ? `meta[${name}]` : `meta[${prop}]`, en: content.trim(), hidden: true, section: "SEO" });
      }
    }
  });

  // 2. Body walk (same depth-first as extract.mjs)
  function walk(el) {
    if (!el) return;
    if (el.type === "text") {
      const txt = el.data;
      if (!shouldSkipString(txt)) {
        const parent = el.parent;
        const hidden = hasHiddenAncestor(parent);
        rows.push({
          id: `t${++idCounter.value}`,
          type: "text",
          en: txt.replace(/\s+/g, " ").trim(),
          hidden,
          section: hidden ? "Hidden scaffold" : sectionHint(parent),
        });
      }
      return;
    }
    if (el.type !== "tag") return;
    if (SKIP_TAGS.has(el.name)) return;
    if (isDynamicElement($, el)) return;

    for (const attr of SEO_ATTRS_ALL) {
      if (el.attribs && attr in el.attribs) {
        const val = el.attribs[attr];
        if (!shouldSkipString(val)) {
          const isVisibleAttr = VISIBLE_ATTRS.includes(attr);
          const hidden = !isVisibleAttr || hasHiddenAncestor(el);
          rows.push({
            id: `t${++idCounter.value}`,
            type: `attr:${attr}`,
            en: val.trim(),
            hidden,
            section: hidden ? (isVisibleAttr ? "Hidden scaffold" : "SEO/A11y") : "Form",
          });
        }
      }
    }
    if (el.children) for (const c of el.children) walk(c);
  }
  walk(body);
  return rows;
}

// ──────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────

async function main() {
  const files = await findHtmlFiles(EN_DIR);
  console.log(`Walking ${files.length} HTML files (detail_* excluded)...`);

  // bucket rows by cluster
  const buckets = new Map();
  for (const c of CLUSTER_ORDER) buckets.set(c, []);
  const sharedRows = [];   // nav + footer, deduped later

  let totalAll = 0, totalVisible = 0;

  for (const absPath of files) {
    const rel = relative(REPO_ROOT, absPath);
    const cluster = classifyCluster(rel);

    const html = await readFile(absPath, "utf8");
    const $ = cheerio.load(html, { decodeEntities: false });
    const body = $("body").get(0);
    const rows = extractWithFilter($, body);
    totalAll += rows.length;

    // Load cn translations to map by id
    const relWithoutEn = rel.replace(/^en\//, "");
    const cnFile = join(CN_DIR, relWithoutEn.replace(/\.html$/, ".json"));
    let cnMap = new Map();
    try {
      const cnData = JSON.parse(await readFile(cnFile, "utf8"));
      for (const s of cnData.strings || []) cnMap.set(s.id, { en: s.en, cn: s.cn || "" });
    } catch { /* no cn file → all CN blank */ }

    // Filter to visible rows only & assemble
    const pageRel = relWithoutEn;
    for (const r of rows) {
      if (r.hidden) continue;            // skip SEO + is-hidden + alt/aria/title/data-wait
      const lookup = cnMap.get(r.id);
      const en = r.en;
      const cn = lookup?.cn || "";
      const row = {
        Page: pageRel,
        ID: r.id,
        Section: r.section,
        EN: en,
        CN: cn,
        "Client notes": "",
      };
      // Nav and Footer strings repeat verbatim on every page — collect them in a
      // dedicated dedup bucket instead of polluting every cluster tab.
      if (r.section === "Nav" || r.section === "Footer") {
        sharedRows.push(row);
      } else {
        buckets.get(cluster).push(row);
      }
      totalVisible++;
    }
  }

  // Dedup shared (Nav/Footer) rows by (Section + EN). Preserve first occurrence
  // order so canonical nav order matches the homepage walk.
  const seen = new Set();
  const sharedDeduped = [];
  for (const r of sharedRows) {
    const key = `${r.Section}::${r.EN}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Drop the per-page Page column since it's shared — keep ID from first sighting
    sharedDeduped.push({
      Section: r.Section,
      EN: r.EN,
      CN: r.CN,
      "Client notes": "",
    });
  }
  // Sort: Nav first, then Footer
  sharedDeduped.sort((a, b) => {
    if (a.Section !== b.Section) return a.Section === "Nav" ? -1 : 1;
    return 0;
  });

  // Build workbook
  const wb = XLSX.utils.book_new();

  // Index sheet
  const indexRows = [["Tab", "Scope", "Strings"]];
  indexRows.push(["Nav & Footer", "Shared across all pages (deduped)", sharedDeduped.length]);
  let grand = sharedDeduped.length;
  for (const cluster of CLUSTER_ORDER) {
    const rows = buckets.get(cluster);
    if (!rows.length) continue;
    const pages = new Set(rows.map(r => r.Page));
    indexRows.push([cluster, [...pages].join(", "), rows.length]);
    grand += rows.length;
  }
  indexRows.push([]);
  indexRows.push(["Total", "", grand]);
  indexRows.push([]);
  indexRows.push(["Notes for reviewer", "", ""]);
  indexRows.push(["", "Edit the CN column directly if you have amendments.", ""]);
  indexRows.push(["", "Use the Client notes column for any comments / questions.", ""]);
  indexRows.push(["", "Nav & Footer tab covers strings that repeat across every page.", ""]);
  indexRows.push(["", "Each cluster tab covers only its page-specific content.", ""]);
  indexRows.push(["", "Hidden / SEO / alt-text content is intentionally excluded from review.", ""]);

  const idxSheet = XLSX.utils.aoa_to_sheet(indexRows);
  idxSheet["!cols"] = [{ wch: 18 }, { wch: 70 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, idxSheet, "Index");

  // Nav & Footer tab (deduped, shared)
  if (sharedDeduped.length) {
    const sheet = XLSX.utils.json_to_sheet(sharedDeduped, {
      header: ["Section", "EN", "CN", "Client notes"],
    });
    sheet["!cols"] = [
      { wch: 10 },   // Section (Nav / Footer)
      { wch: 60 },   // EN
      { wch: 60 },   // CN
      { wch: 30 },   // Notes
    ];
    sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, sheet, "Nav & Footer");
  }

  // One sheet per cluster (now without nav/footer noise)
  for (const cluster of CLUSTER_ORDER) {
    const rows = buckets.get(cluster);
    if (!rows.length) continue;
    const sheet = XLSX.utils.json_to_sheet(rows, {
      header: ["Page", "ID", "Section", "EN", "CN", "Client notes"],
    });
    sheet["!cols"] = [
      { wch: 38 },   // Page
      { wch: 6 },    // ID
      { wch: 12 },   // Section
      { wch: 70 },   // EN
      { wch: 70 },   // CN
      { wch: 30 },   // Notes
    ];
    sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    // Sheet name limited to 31 chars
    const safe = cluster.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, sheet, safe);
  }

  XLSX.writeFile(wb, OUT_PATH);
  console.log(`\nSummary:`);
  console.log(`  Total strings walked:           ${totalAll}`);
  console.log(`  Visible (before dedup):         ${totalVisible}`);
  console.log(`  Nav/Footer rows collapsed:      ${sharedRows.length} → ${sharedDeduped.length}`);
  console.log(`  Excluded (SEO/hidden):          ${totalAll - totalVisible}`);
  console.log(`\nWrote: ${OUT_PATH}`);
  console.log(`Tabs: Index, Nav & Footer, ${[...buckets.entries()].filter(([_,v]) => v.length).map(([k]) => k).join(", ")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
