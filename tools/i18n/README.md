# i18n Translation Pipeline

Tools for translating the static `en/` HTML pages into other locales (currently `cn/`).

## Folder layout

```
en/                   ← source-of-truth English HTML pages (Webflow export)
cn/                   ← built Simplified Chinese pages (do not hand-edit)
i18n/
  ├─ en/              ← extracted English snapshot (do not hand-edit, regenerable)
  └─ cn/              ← TRANSLATOR WORKSHEET (edit `cn` field on each entry)
tools/i18n/
  ├─ extract.mjs      ← reads en/*.html, writes i18n/en + i18n/cn
  ├─ build.mjs        ← reads en/*.html + i18n/cn, writes cn/*.html
  └─ package.json
```

## Workflow

### 1. Initial extraction (already done)

```bash
cd tools/i18n
npm install
node extract.mjs
```

Produces:
- `i18n/en/*.json` — clean English snapshot for reference / diffs
- `i18n/cn/*.json` — translator's worksheet, one row per translatable string

### 2. Translation

Open each file in `i18n/cn/` and fill in the `cn` field for every entry:

```json
{
  "id": "t9",
  "type": "text",
  "context": "div.navbar5_dropdown-toggle > a > div",
  "en": "About Us",
  "cn": "关于我们"     ← fill this in
}
```

**Do not modify**: `id`, `type`, `context`, `en`. Only fill `cn`.

### 3. Build

After translations are filled in, run:

```bash
cd tools/i18n
node build.mjs
```

This regenerates `cn/*.html` by:
1. Walking each `en/*.html` in the same deterministic order as extract
2. Looking up the cn translation by sequential ID
3. Replacing text/attributes in place
4. Setting `<html lang="zh-Hans">`
5. Rewriting internal links from `en/` → `cn/`
6. Pointing the language switcher (`#lnkLangOpt`) back to `en/`

If a `cn` field is empty, the original English is kept and a warning is logged.

### 4. Re-extraction (when EN content changes)

If the client updates the English HTML, run `node extract.mjs` again.

The script preserves existing `cn` translations: when a `(id, en)` pair matches a previously translated entry, the `cn` value is carried over. New strings appear with `cn: ""`. Removed strings disappear.

## What gets extracted (static content)

- Visible text in `<body>` (excluding `<script>`, `<style>`, `<noscript>`)
- Translatable attributes: `alt`, `title`, `placeholder`, `aria-label`, `data-wait`
- `<title>` tag content
- `<meta>` tags: `description`, `og:title`, `og:description`, `twitter:title`, `twitter:description`

## What gets skipped (dynamic / brand / non-text)

**Dynamic CMS content** (handled separately in Contentful):
- Anything inside elements with `data-cms`, `data-cms-template`, `data-cms-list`, `data-cms-href`, `data-cms-src`
- Elements with class `w-dyn-bind-empty`

**Untranslatable tokens** (case-insensitive exact match):
- `IOI`, `IOI Oleochemical`, `IOI Oleochemical Industries Berhad`
- `IOI Acidchem`, `IOI Acidchem Sdn. Bhd.`
- `IOI Esterchem`, `IOI Esterchem (M) Sdn. Bhd.`
- `IOI Pan-Century`, `IOI Pan-Century Edible Oils Sdn. Bhd.`, `IOI Pan-Century Oleochemicals Sdn. Bhd.`
- `Palmac`, `Palmsurf`, `Palmsabun`

**Pattern-based skips**:
- Whitespace-only strings
- Numeric / phone-like strings
- Single characters
- URLs (`http(s)://...`)
- Email addresses
- Copyright notices

## Files ignored entirely

- `en/about-us/job-listings2.html` (Webflow duplicate)
- `en/product-finder (2).html` (Webflow duplicate)
- `en/product-finder (3).html` (Webflow duplicate)
- `en/style-guide-*.html` (Webflow style guide)

## Stats

- 38 source HTML files
- ~1973 translatable strings extracted

## Adding a new locale (e.g. `bm/` for Bahasa Melayu)

1. Add a new worksheet folder: `i18n/bm/` (copy `i18n/en/` and add empty `cn`-equivalent fields)
2. Edit `extract.mjs` and `build.mjs` to parameterize the language target
3. Run build pointing at `i18n/bm/` → outputs to `bm/*.html`
