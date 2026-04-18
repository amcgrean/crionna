# Críonna — Claude Code Build Gameplan

**Críonna** (*KREE-nuh*, Irish for "wise, prudent") is a personal shopping-value app. It helps the user compare products across Walmart, Target, Costco, and Amazon by normalizing units, respecting quality, and surfacing real effective prices after promos. Built mobile-first as a Next.js PWA, with a self-documenting ingestion log that becomes training data for iterative improvement.

This document is the full build plan. It is intentionally long — it encodes architectural decisions, a phased build order, and the non-obvious pitfalls worth avoiding. Read it in full before writing any code.

---

## Core Principles (read first, reference often)

1. **Cheapest adequate technology wins.** Parse JSON-LD before calling Claude. Use Tesseract.js in the browser before sending images to a vision API. Reach for AI only when deterministic parsing fails.
2. **Every ingestion generates a markdown audit log.** Day one. Not optional. The logs are the training corpus for future prompt improvements and let Claude Code review the system over time.
3. **Quality weighting is the feature.** Every tool that tracks prices is cheapest-wins. Críonna's differentiator is best-value-weighted. Don't bury this in the UI.
4. **Mobile-first, always.** The user builds for phones. Desktop is a bonus, not the target.
5. **Swappable extractors.** The ingestion layer takes an input and returns a structured object. Whether that's JSON-LD parsing, Tesseract + Claude text, or Claude vision is an implementation detail routed by the input type.
6. **Own your data.** The app is a personal tool. Export to CSV must always work. No lock-in. No analytics. No tracking.
7. **Build the audit trail before the app views.** It's load-bearing infrastructure, not a feature to add later.

---

## Stack

- **Frontend + API:** Next.js 15 (App Router, TypeScript) on Vercel Pro (60s function timeout needed for Claude calls)
- **Database:** Neon Postgres + Drizzle ORM
- **Auth:** Auth.js with email magic link (single user for V1, multi-user-ready schema)
- **Image storage:** Cloudflare R2 with signed uploads (images never pass through Vercel)
- **AI:** Anthropic Claude API (text-only for structuring, vision only as fallback)
- **URL fetching:** Firecrawl API for retailer pages (handles anti-bot reasonably); plain fetch as first attempt
- **Browser OCR:** Tesseract.js (WASM) for screenshot text extraction
- **Ingestion log:** Separate private GitHub repo `crionna-ingestion-log`; written to via GitHub REST API from the serverless ingestion endpoint
- **Barcode scan (later):** `@zxing/browser` for UPC decoding via camera

V2 (not in this build): Scheduled scraping for price tracking, which lives on the user's Raspberry Pi in a separate Docker service that writes to the same Neon DB. Do not scope V2 into V1.

---

## Data Model

### Tables (Drizzle schema)

```ts
users                     // Auth.js compatible
  id, email, name, created_at

categories
  id, slug, label, base_unit, unit_type
  // unit_type: 'area' | 'volume' | 'weight' | 'count'
  // base_unit: '100 sq ft' | 'fl oz' | 'lb' | 'count' etc.
  normalization_spec      // JSON; which item fields feed the math

items
  id, user_id, category_id
  retailer                // enum: 'Walmart' | 'Target' | 'Costco' | 'Amazon' | 'Other'
  brand, name
  url                     // nullable
  image_url               // nullable, R2 URL
  upc                     // nullable
  tier                    // 'premium' | 'national' | 'store' (user-set)
  quality                 // 1-5, user-set
  notes                   // free text, user-set
  specs                   // JSONB; category-specific fields
  current_price, current_promo_price, current_promo_label
  last_updated
  created_at

prices                    // V2-ready but wire in V1
  id, item_id
  price, promo_price, promo_label
  source                  // 'url' | 'screenshot' | 'photo' | 'manual'
  captured_at

ingestion_logs            // index/metadata only; full log lives in git repo
  id, user_id, item_id
  source_type, log_file_path (repo-relative)
  status                  // 'saved' | 'saved_with_corrections' | 'abandoned'
  correction_count
  created_at
```

### Why specs is JSONB

Each category has different attributes (paper towels: sheets/roll, ply; detergent: fl oz, load count; cereal: net weight oz). A JSONB column avoids a table explosion. The category's `normalization_spec` tells the normalize function which keys to read. Schema validation happens at the application layer via Zod, per category.

### Seed categories for V1

- `paper-towels` — base_unit: `100 sq ft`, unit_type: `area`
- `toilet-paper` — base_unit: `100 sq ft`, unit_type: `area`
- `laundry-detergent` — base_unit: `load`, unit_type: `count` (loads)
- `dish-soap` — base_unit: `fl oz`, unit_type: `volume`
- `trash-bags` — base_unit: `bag`, unit_type: `count`

Start with these five. Add more once the ingestion pipeline is proven.

---

## Ingestion Architecture

This is the heart of the app. Treat it as a pipeline with three entry points and one exit.

### Three input paths

**A. URL paste**
1. User pastes URL on mobile
2. Client sends URL to `/api/ingest/url`
3. Server fetches HTML (plain `fetch` first, Firecrawl fallback on 4xx/5xx or bot-block detection)
4. **Parse JSON-LD first** — extract `Product` schema. Get name, brand, price, image, GTIN, description. Done deterministically with zero AI cost.
5. Pass product name + description + category hint to Claude text-only with a category-specific extraction prompt. Get specs (sheets/roll, ply, fl oz, etc.).
6. Return merged object to client for review

**B. Screenshot upload (most common path)**
1. User selects or drops screenshot on mobile
2. Client runs Tesseract.js in-browser (~1–2s on modern phones). Gets extracted text with per-word confidence scores.
3. Client sends extracted text + average confidence + image dimensions + (optionally) small thumbnail to `/api/ingest/screenshot`
4. If average confidence > 0.85 → server calls Claude text-only with the extracted text
5. If confidence < 0.85 or user marked it as a photo (not screenshot) → fall back to path C
6. Return structured object for review

**C. Photo / low-confidence image**
1. Client uploads image to R2 via pre-signed URL
2. Client calls `/api/ingest/vision` with the R2 object key
3. Server calls Claude vision with the R2 URL
4. Return structured object for review

**D. Manual entry**
1. User fills form on mobile
2. Submit → straight to DB, status `manual`
3. Still generates a log entry (source: `manual`) for consistency

### Category-aware extraction prompts

Each category has its own extraction prompt stored as a markdown file in `lib/extractors/`. This is intentional — markdown is human-editable, Claude Code can propose diffs, and version control gives us history.

```
lib/extractors/
├── _base.md                  # shared prelude: JSON output rules, unit cleanup
├── paper-towels.md           # fields: size, sizeUnit, sheetsPerRoll, ply, sheetDims
├── laundry-detergent.md      # fields: fl_oz, loads, form (liquid/pod/powder)
├── dish-soap.md
└── trash-bags.md
```

Each extractor prompt:
- Declares the target fields with types
- Gives 2–3 worked examples (real product names and the correct extraction)
- Lists known pitfalls ("Bounty lists 'Mega Roll = 2 Regular Rolls' — always use the Mega count")
- Specifies fallback behavior when a field is missing

The extractor prompt is selected by category. Category detection is a separate smaller Claude call if the user doesn't pick a category at ingestion time, though **V1 should require the user to pick a category before ingesting** to keep this simple.

### Merged extraction output shape

```ts
{
  source: 'url' | 'screenshot' | 'photo' | 'manual',
  category: string,
  retailer: 'Walmart' | 'Target' | 'Costco' | 'Amazon' | 'Other',
  brand: string,
  name: string,
  url?: string,
  image_url?: string,
  upc?: string,
  price: number,
  promo_price?: number,
  promo_label?: string,
  specs: Record<string, unknown>,   // category-specific
  confidence: {
    overall: number,                // 0-1
    fields: Record<string, number>  // per-field confidence 0-1
  },
  source_breakdown: {
    // for the audit log: which fields came from where
    json_ld: string[],
    ai_extraction: string[],
    manual: string[]
  }
}
```

Return this to the client. The client renders a review form with confidence indicators (low-confidence fields highlighted for user attention). User reviews, corrects, hits save.

---

## Ingestion Audit Log (critical — build first)

Every ingestion writes a markdown file to a separate private GitHub repo. This is the system's observability and the training corpus for future improvements.

### Log file structure

```markdown
---
id: 01HXYZ...                  # ULID
timestamp: 2026-04-17T10:34:22-05:00
source: url                     # url | screenshot | photo | manual
category: paper-towels
retailer: Walmart
status: saved_with_corrections  # saved | saved_with_corrections | abandoned
prompt_version: paper-towels-v3
model: claude-opus-4-7
---

# Bounty Select-A-Size Mega at Walmart

## Source
URL: https://www.walmart.com/ip/bounty-select-a-size-...
Fetched: 2026-04-17T10:34:18Z
Method: firecrawl (fallback after fetch 403)

## JSON-LD extracted
- brand: Bounty
- name: Bounty Select-A-Size Mega Rolls
- price: 28.47
- gtin: 030772055632
- image: https://i5.walmartimages.com/...

## AI extraction (paper-towels-v3)
Prompt: ./extractors/paper-towels-v3.md
Input text: [2847 chars, saved to ./raw/01HXYZ.txt]
Output:
- size: 12
- sizeUnit: rolls
- sheetsPerRoll: 101  ❌ user corrected to 110
- ply: 2
- sheetDimsIn: 66

## User review
- Quality: 5 ★
- Notes: "Gold standard. Worth it for messes."
- Corrections: sheetsPerRoll (101 → 110)
- Time to review: 18s

## Observations
- `sheetsPerRoll` appeared twice in the page: "101 sheets per regular roll" and "110 sheets per Mega roll"
- The extractor picked the first match (regular). Should prefer the value closest to the product name qualifier (Mega).
```

### Log writing flow

1. Ingestion endpoint completes extraction
2. Endpoint constructs markdown log
3. Endpoint calls GitHub REST API to commit the file to `crionna-ingestion-log/YYYY-MM/<ULID>_<slug>.md`
4. On user save (with or without corrections), endpoint appends the "User review" section via a second commit
5. Repo `INDEX.md` is auto-maintained — a reverse-chron list of the last N ingestions with status and category

GitHub App (not personal access token) for the commits. The app has write access only to the single log repo.

### `CLAUDE.md` in the log repo

A companion `CLAUDE.md` sits at the root of the log repo, defining the review workflow:

```markdown
# Crionna Ingestion Log — Review Workflow

When the user asks for a system review, perform the following:

1. Read INDEX.md for the last 30 days of entries
2. Filter to status: saved_with_corrections
3. Group corrections by (category, retailer, field)
4. For any (category, retailer, field) group with 3+ corrections in the window:
   a. Identify the pattern — what consistently goes wrong?
   b. Propose a prompt amendment in `lib/extractors/<category>.md`
   c. If the pattern affects multiple categories, propose a change to `_base.md`
   d. If a user correction reveals a missing field, propose a schema addition
5. Output a PR description that cites specific log file paths as evidence
6. Never invent log entries or corrections — only reference real ones
```

This is where the "ready to learn from day one" idea pays off. Claude Code reads the logs, finds patterns, proposes changes. The user reviews and merges. The prompts get better. The loop closes.

---

## UI / UX

The design is already defined. Use the existing Críonna mobile component as the reference (`crionna.jsx` in the conversation — Irish heritage palette, Fraunces + JetBrains Mono, bottom sheet patterns, FAB for Add).

### V1 screens

1. **Compare** — category-focused, sorted cards, two winner callouts (Best Value + Cheapest)
2. **Items** — searchable list grouped by category
3. **Deals** — items with active promos, sorted by savings
4. **Add Item** — bottom sheet with four entry modes (URL, Photo, Scan, Manual)
5. **Item Detail** — bottom sheet with full specs, user notes, update-price action
6. **Review screen** — post-extraction, pre-save form with confidence indicators

### Mobile-first requirements

- Max container width 480px, centered on desktop
- Bottom nav with center FAB for Add
- All modals are bottom sheets with grabber handles, not center dialogs
- Minimum 44px touch targets
- `env(safe-area-inset-bottom)` respected on nav
- Tesseract.js runs on the client — test on actual phone, not just desktop simulation
- Category picker must be thumb-reachable (bottom half of screen)

### Irish heritage palette

```ts
const C = {
  cream: '#F5EDDC',      // background
  creamLight: '#FAF4E6', // cards
  creamEdge: '#E5DAC3',  // borders
  green: '#0F5132',      // primary
  greenDeep: '#0A3A23',  // darker variant
  gold: '#C8A04B',       // accents
  goldSoft: '#E8D5A8',   // soft accents
  burgundy: '#8B2635',   // deals / cheapest
  ink: '#1A1F1A',        // text
  inkSoft: '#5B6155',    // muted text
  stone: '#A89D85',      // labels
};
```

Fraunces (display, italic for emphasis) + JetBrains Mono (data/labels). No emoji. No generic SaaS blue.

---

## Build Phases

Build in this order. Do not skip ahead. Each phase has a clear "done" definition.

### Phase 0 — Repo setup (half day)

1. Create two repos: `crionna` (app) and `crionna-ingestion-log` (logs, private)
2. Scaffold Next.js 15 with TypeScript, Tailwind, Drizzle
3. Provision Neon, R2 bucket, Vercel project, Anthropic API key, GitHub App for log commits
4. `.env.local` with all secrets. `.env.example` committed. Zod-validated env loader.
5. Write root `CLAUDE.md` for the app repo defining code style, testing expectations, and when to consult the log repo for context.

**Done when:** `pnpm dev` runs, `pnpm db:push` applies schema to Neon, a smoke-test ingestion writes a test log file to the log repo.

### Phase 1 — Ingestion pipeline + audit log (2–3 days, the load-bearing work)

1. Drizzle schema for `users`, `categories`, `items`, `prices`, `ingestion_logs`
2. Seed five categories with normalization specs
3. Build category-specific extraction prompts in `lib/extractors/` as markdown files with versioning (filename carries version: `paper-towels-v1.md`)
4. Build `lib/extract/jsonLd.ts` — deterministic JSON-LD parser for Product schema
5. Build `lib/extract/claude.ts` — thin wrapper over Anthropic SDK for text-only structured extraction, returns typed result with field-level confidence
6. Build `lib/extract/vision.ts` — same shape as above but for vision input (R2 URL)
7. Build `lib/ingest/router.ts` — routes input type to the right extractor combo
8. Build `/api/ingest/url`, `/api/ingest/screenshot`, `/api/ingest/vision`, `/api/ingest/manual`
9. Build `lib/log/markdown.ts` — generates the log markdown from an ingestion result
10. Build `lib/log/github.ts` — commits log files and updates INDEX.md via GitHub App
11. Write integration tests using real (sanitized) sample HTML for each retailer
12. Write `CLAUDE.md` in the log repo defining the review workflow

**Done when:** a URL can be pasted via curl, the correct extraction happens, a log file is committed to the log repo, and INDEX.md is updated.

### Phase 2 — Mobile UI shell (1–2 days)

1. Port the Críonna mobile component from the artifact into real Next.js routes
2. Implement bottom nav, FAB, bottom sheet primitives
3. Implement Compare, Items, and Deals views with mock data
4. Implement detail bottom sheet
5. Implement Add bottom sheet with all four mode entry points (backed by real endpoints from Phase 1)
6. Build the post-extraction review form with per-field confidence indicators and inline edit

**Done when:** a user can paste a URL on their phone, see the extracted review form, correct a field, save, and see it in the Items list.

### Phase 3 — Screenshot path (1 day)

1. Integrate Tesseract.js, preload WASM on first Add sheet open
2. Wire screenshot-mode to run OCR client-side, send text + confidence to `/api/ingest/screenshot`
3. Confidence routing: low-confidence OCR falls through to vision path
4. Test on actual phone with screenshots from all four retailer apps

**Done when:** screenshotting a Walmart app product tile and uploading it produces a clean extraction without server-side image processing.

### Phase 4 — Comparison engine (1 day)

1. Build `lib/compare/normalize.ts` — given an item and its category, compute the normalized unit price
2. Build `lib/compare/value.ts` — quality-weighted value score (see formula below)
3. Wire Compare view to real data from Neon filtered by selected category
4. Render winner cards with live data
5. Ensure the math handles edge cases: missing specs (exclude item), promo vs. regular price toggle (default to effective/promo price when present)

Value score formula (V1):
```
valueScore = normalizedPrice / (quality / 3)
```
Lower score = better value. Tunable. The divisor can become user-configurable later.

**Done when:** switching categories in the Compare view recomputes winners correctly from live DB.

### Phase 5 — Polish pass (1 day)

1. Export to CSV endpoint (all items, per-category)
2. Edit item modal (update price, edit quality/notes, change category)
3. Delete item with confirmation
4. PWA manifest, installable on iOS/Android
5. Auth.js with magic link email
6. Basic error boundaries and toasts
7. Log repo INDEX.md auto-generation cron (daily, via Vercel Cron)

**Done when:** the app can be installed to a phone home screen, a full end-to-end flow works under real use, and the user can export their data.

### Phase 6 — First review loop (ongoing)

After ~50 real ingestions:

1. Open Claude Code in the `crionna-ingestion-log` repo
2. Run the review workflow defined in its `CLAUDE.md`
3. Claude Code proposes extractor prompt amendments as PRs to the `crionna` app repo
4. User reviews, merges, redeploys
5. Repeat monthly

---

## Non-Obvious Pitfalls to Avoid

1. **Don't let Vercel timeouts bite.** Claude vision on a large image plus text extraction can blow past 10 seconds. Confirm Vercel Pro is active (60s limit) before shipping. Stream responses where possible.

2. **Tesseract.js has a cold start.** First run downloads ~15MB of WASM + language data. Preload it on Add-sheet open, not on Submit, or the first screenshot will feel broken.

3. **JSON-LD isn't always where you expect.** Some retailers embed it inside nested `@graph` structures. Use `jsonld` library or equivalent, not a simple regex.

4. **Costco frequently gates prices behind login.** Expect JSON-LD to return `availability: out_of_stock` or missing prices on many Costco URLs. Document this. For Costco, fallback to screenshot path is common, not exceptional.

5. **Retailer page structures change.** This is why JSON-LD is preferable — it's the stable contract. Resist the temptation to scrape HTML with CSS selectors. If JSON-LD is missing, use Firecrawl + Claude, not a bespoke scraper.

6. **Barcode scanning is phase 7+.** It's not critical for V1 and adds native-camera-API complexity. Skip until the app has real use.

7. **Don't store Costco/Walmart/Target login credentials in the app.** V1 doesn't need them — member prices come from screenshots the user captures while already logged into the retailer app. This is a deliberate design choice for privacy and scope, not a limitation to fix later.

8. **UPC ≠ retailer SKU.** Same product can have different SKUs across retailers. The `upc` column is for identity; comparison joins on category + user judgment, not on SKU equality.

9. **Quality ratings are irreducibly user-provided.** Don't try to infer them from reviews or ratings. That defeats the point — the user's judgment is the feature.

10. **The log repo grows unboundedly.** At ~5KB per ingestion that's fine for years, but set a policy: logs older than 2 years archive to a tarball and drop from git. Don't engineer this in V1; just note it.

11. **Never run Playwright on Vercel.** Any scraping that requires a real browser session happens on the user's Pi or Mac mini in V2. Vercel serverless is request/response only.

12. **The app must work without the log repo.** If GitHub is down, ingestion still succeeds — the log write is best-effort and retryable from a queue. The DB is the source of truth; the log is the audit trail.

---

## What's Explicitly Out of Scope for V1

These are real features that belong in V2 or later. Do not add them now; they muddy the V1 build.

- Scheduled price tracking (any form of automated re-fetching)
- Playwright/Selenium for logged-in retailer sessions
- Barcode scanning
- Multi-user sharing / household accounts
- Push notifications for price drops
- Deal aggregation from weekly ads
- Product image pipeline (borrowed from the List Ingestor PIP project — belongs there, not here)
- Integrations with shopping list apps
- Receipt parsing for batch ingestion

Write a `ROADMAP.md` with these items listed but out of scope. Do not build any of them until V1 is stable and being used daily.

---

## Claude Code Starting Instructions

When the user opens Claude Code in the fresh `crionna` repo and says "start building," do the following:

1. Read this entire document before writing any code
2. Confirm understanding of the three-path ingestion architecture, the markdown audit log, and the Irish palette
3. Start Phase 0. Do not skip to UI work.
4. For each phase, present the plan, get confirmation, then execute
5. After each phase, run the "done when" check together with the user
6. Never add a feature from the "out of scope" list without explicit user approval
7. Every extraction prompt added to `lib/extractors/` must be versioned (filename includes `-v1`, `-v2`, etc.) and must be referenced by version in the ingestion log frontmatter
8. Default to paraphrasing / summarizing / restructuring; only quote the user's own prior notes verbatim

When in doubt about architecture, re-read the Core Principles section. They resolve most ambiguities.

---

## Success Criteria for V1

The user should be able to:

1. Stand in a Costco aisle, screenshot a warehouse-only price on their phone, and have Críonna extract and save it in under 30 seconds
2. Paste a Walmart URL from the browser share sheet and have it saved in under 10 seconds
3. Open the Compare view for paper towels and see all four retailers ranked correctly with the Best Value winner highlighted based on their personal quality ratings
4. Export the full library to CSV at any time
5. Install Críonna to their phone's home screen as a PWA
6. After one month of use, open Claude Code and have it review the ingestion log, propose extractor improvements, and merge them via a PR

If all six are true, V1 is done.
