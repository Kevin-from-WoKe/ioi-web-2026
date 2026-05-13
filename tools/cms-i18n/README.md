# Contentful CMS Bulk Translation Tool

Exports all English Contentful entries to Excel, lets a translator fill the Chinese column, then imports the translations back as `zh-Hans` locale values.

## Prerequisites

1. **Contentful Management Token** — go to  
   `https://app.contentful.com → Settings → API Keys → Content management tokens`  
   Create a personal token with write access to the IOI Oleochemical space.

2. **Node.js 18+** (same as the rest of the project).

## Setup

```bash
cd tools/cms-i18n
npm install

# Create your local .env (git-ignored — never commit the real token)
cp .env.example .env
# Edit .env and paste your CONTENTFUL_MANAGEMENT_TOKEN
```

## Workflow

### 1. Export

```bash
node export.mjs
```

Produces **`contentful-translations.xlsx`** in this directory.  
One sheet per content type (e.g. *CSR Event*, *Product*, *Office*, …).

Columns:

| Column | Description |
|--------|-------------|
| `entry_id` | Contentful entry ID — **do not edit** |
| `field_id` | Field API name — **do not edit** |
| `field_label` | Human-readable field name |
| `en_value` | English source text — **do not edit** |
| `cn_value` | **← Translator fills this column** |
| `_type` | Internal field type (Symbol / Text / RichText) |

Existing `zh-Hans` values are pre-filled in `cn_value` so re-runs are incremental — the translator only needs to fill blanks.

### 2. Translate

Open `contentful-translations.xlsx` in Excel or Google Sheets.  
Fill the **`cn_value`** column on each sheet.  
Leave `en_value`, `entry_id`, and `field_id` untouched.

### 3. Import

```bash
# Dry-run first — prints what would change without touching Contentful
node import.mjs --dry

# Apply when happy
node import.mjs
```

Options:

| Flag | Effect |
|------|--------|
| `--dry` | Dry-run: prints changes, writes nothing |
| `--sheet "CSR Event"` | Only process one sheet (useful for testing) |

The importer:
- Fetches each entry, sets `fields[fieldId]["zh-Hans"]`
- Re-publishes entries that were already published
- Skips fields where the CN value matches what's already in Contentful
- Rate-limits to ~5 req/s to stay within Contentful's CMA limits

## Content types exported

| Content type | Notes |
|---|---|
| `award` | Award titles / descriptions |
| `companyCertificate` | Company cert descriptions |
| `csrEvent` | CSR event titles, descriptions |
| `ecocertCertification` | Ecocert cert details |
| `halalCertification` | Halal cert details |
| `jobListing` | Job titles, descriptions |
| `kosherCertification` | Kosher cert details |
| `milestone` | Milestone titles, descriptions |
| `office` | Office names, addresses |
| `policyStatement` | Policy titles, content |
| `product` | Product names, descriptions |
| `productApplication` | Application names, descriptions |
| `productVariant` | Variant names, specs |

> Slugs, asset references, numbers, booleans, and non-localized fields are excluded automatically.

## Rich Text fields

Rich Text is exported as **plain text** (paragraphs joined by `\n\n`).  
On import it is wrapped back into a minimal Rich Text document.

If an entry uses complex Rich Text (embedded entries, tables, custom marks),  
translate those fields directly in the Contentful web editor — they will not round-trip cleanly through plain text.

## .gitignore note

`.env` and `contentful-translations.xlsx` are git-ignored (contain credentials / working files).
Add them to `.gitignore` at the repo root if not already there.
