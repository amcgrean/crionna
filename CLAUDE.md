# Críonna — Claude Code Context

## What this app is
A personal shopping-value tool. It ingests product data (URL, screenshot, photo, manual), normalizes prices to a common unit, applies a user quality rating, and surfaces the best *value* — not just the cheapest price. The differentiator is quality-weighted comparison, not raw price sorting.

## Core principles (resolve ambiguity here)
1. Cheapest adequate technology. Parse JSON-LD before calling Claude. Run Tesseract in-browser before sending an image to a vision API. AI is the last resort.
2. Every ingestion generates a markdown audit log written to the `crionna-ingestion-log` repo. Day one. Not optional.
3. Quality weighting is the feature. `valueScore = normalizedPrice / (quality / 3)`. Lower = better. Don't bury it.
4. Mobile-first. Max container 480px. Bottom sheets, not center modals. 44px touch targets. `env(safe-area-inset-bottom)` on nav.
5. Swappable extractors. All extractors return the same shape. Input type routes to the right extractor — the exit shape never changes.
6. Own your data. CSV export always works. No analytics, no tracking.
7. Audit trail before app views. The log is load-bearing, not a feature.

## Code style
- TypeScript strict mode. No `any`. Use Zod for all external data.
- Drizzle ORM only — no raw SQL unless Drizzle genuinely can't express it.
- No comments explaining *what* code does. Only add a comment when the *why* is non-obvious.
- No `console.log` left in committed code. Use structured error returns.
- All API routes return `{ data, error }` shape. Never throw from a route handler.
- Extraction prompts live in `lib/extractors/` as versioned `.md` files (`paper-towels-v1.md`). The version number is referenced in the ingestion log frontmatter. Never edit a prompt file in place — create a new version.

## Ingestion pipeline (three paths, one exit)
- **URL path:** `fetch` → Firecrawl fallback → JSON-LD parse → Claude text-only for specs
- **Screenshot path:** Tesseract.js (client) → if confidence > 0.85 → Claude text-only; else fall through to photo path
- **Photo path:** R2 upload → Claude vision
- **Manual:** straight to DB, still writes a log entry
- All paths return the `ExtractionResult` type from `lib/types/extraction.ts`

## When to consult the ingestion log repo
Before changing any file in `lib/extractors/`, open Claude Code in `crionna-ingestion-log` and run its review workflow. The patterns in the corrections are the evidence base for prompt changes.

## Out of scope for V1
See `ROADMAP.md`. Do not build anything on that list without explicit user approval.

## Irish heritage palette
```
cream: #F5EDDC   creamLight: #FAF4E6   creamEdge: #E5DAC3
green: #0F5132   greenDeep: #0A3A23
gold: #C8A04B    goldSoft: #E8D5A8
burgundy: #8B2635
ink: #1A1F1A     inkSoft: #5B6155     stone: #A89D85
```
Fraunces (display/serif) + JetBrains Mono (data/labels). No emoji. No generic SaaS blue.

## Deployment
- Runs in Docker on local hardware (Pi or Mac mini). No Vercel.
- Cloudflare Tunnel (`cloudflared`) provides the public HTTPS URL for phone access.
- `docker compose up --build` is the full deploy. No serverless constraints — no timeout worries.
- `NEXT_PUBLIC_APP_URL` should be set to the Cloudflare tunnel hostname in `.env.local`.

## Testing expectations
- Unit test all normalization math in `lib/compare/`
- Integration test each ingestion path with real sanitized sample HTML per retailer
- No mocking of Drizzle — use a test Neon branch
- Smoke test: `scripts/smoke-log.ts` writes a test entry to the log repo and must succeed in CI
