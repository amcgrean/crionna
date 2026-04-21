# Críonna — Roadmap

## V1 (current build)

See `crionna-gameplan.md` for the full phased plan. V1 is complete when the six success criteria in that document are all true.

## Out of scope for V1

These are real features. They belong in V2 or later. Do not build any of them until V1 is stable and being used daily. Any addition requires explicit approval.

| Feature | Notes |
|---|---|
| Scheduled price tracking | Lives on the user's Raspberry Pi in a separate Docker service; writes to same Neon DB |
| Playwright / Selenium for logged-in sessions | Server-side browser automation doesn't run on Vercel serverless |
| Barcode scanning | `@zxing/browser` via camera — adds native-camera-API complexity; skip until V1 is stable |
| Multi-user sharing / household accounts | Schema is multi-user-ready; the feature is not |
| Push notifications for price drops | Requires scheduled tracking first |
| Deal aggregation from weekly ads | Separate ingestion surface; out of scope |
| Product image pipeline | Belongs in the List Ingestor PIP project, not here |
| Shopping list app integrations | No integrations in V1 |
| Receipt parsing for batch ingestion | High complexity; not a core use case |
| Log repo archival / tarball rotation | At ~5KB per ingestion this is fine for years; revisit in V3 |

## V2 ideas (not committed)

- Raspberry Pi scraper service for automated price-track polling
- Household account sharing
- Barcode scan via phone camera
- Price drop alerts
