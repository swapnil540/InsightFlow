# InsightFlow Phase 2 Report

**Phase:** MongoDB/Mongoose data layer and deterministic sample seeding
**Status:** Complete; owner-run MongoDB write and verification succeeded
**Verified seed anchor:** `2026-10-12T08:00:00Z`

## Purpose

Phase 2 provides the persistence models and seed data used by later InsightFlow
phases. It retains all source feedback rows and duplicates, attaches one
adapted analysis per normalized text hash, and clearly marks generated sample
dates and sources as simulated.

## Implementation

- `models/feedback.js`: source text, text hash, category, source, timestamp,
  simulation marker, and embedded analysis. Content hashes are not unique so
  duplicate feedback remains valid. Indexes cover text hash, created date,
  analysis topic and sentiment, category, source, text search, and seed key.
- `models/analysis.js`: one cached structured analysis per unique text hash.
- `models/issue.js`: issue status, owner, notes, topic, and priority snapshot.
- `models/report.js`: unique share token, title, and report payload.
- `models/adaptionRun.js`: run identity, role, status, row counts, evaluation
  metrics, quality components, credits/duration, notes, and config snapshot.
- `services/textHash.js`: trims outer whitespace, collapses internal
  whitespace, lowercases, then SHA-1 hashes the UTF-8 normalized text.
- `services/seedData.js`: preserves every row from `data/raw_feedback.csv`,
  validates adapted hashes/topics, and generates deterministic simulated
  timestamps and sources with Mulberry32 seed `0x1f10f10`.
- `services/adaptionRunSeedData.js`: prepares the smoke, labels-retest, and
  full-run-evaluation records from the checked-in metadata files.
- `scripts/seed.js`: dry run, repeatable upsert, index ensuring, and detailed
  database verification. It does not clear collections or delete issues or
  reports.
- `routes/pages.js`: `/health` reports collection counts while connected and
  returns null counts if MongoDB is unavailable.
- `test/phase2.test.js`: tests hash parity, data counts, deterministic dates and
  sources, schema/index declarations, and the three AdaptionRun records.

## Simulated data contract

- Default anchor is seed start time rounded down to the UTC hour; `--anchor`
  accepts a fixed ISO date-time. Use the same anchor for dry/write/verify.
- Each feedback timestamp lies in the 90 days ending at the anchor.
- Complaints with a `fraud_*` topic or `delivery_delay` receive approximately
  45% of timestamps in the most recent 21 days and 55% in the preceding 69
  days. Other rows are uniform across all 90 days.
- Customer Service source weights are Support 60%, Review 25%, Survey 15%.
  Other categories use Review 55%, Survey 25%, Support 20%.
- All sample feedback has `isSimulated: true`. Source and timestamp values are
  generated demo data, not facts from the original CSV.

## Database verification results

The owner ran `seed:dry`, `seed:write`, and `seed:verify` with anchor
`2026-10-12T08:00:00Z`. The write and verification output confirmed:

| Check | Result |
|---|---:|
| Feedback records | 7,000 |
| Cached analyses | 320 |
| AdaptionRun records | 3 |
| Simulated feedbacks | 7,000 |
| Product Feedback | 1,738 |
| Customer Service | 1,707 |
| Operational Issues | 1,800 |
| Fraud and Scam | 1,755 |
| Missing analysis references | 0 |
| Topics outside taxonomy | 0 |
| Missing/invalid embedded analysis | 0 |
| Inconsistent embedded/cache references | 0 |
| `scam` text-search results | 3 |

The simulated `createdAt` range was `2026-07-14T08:04:17.841Z` through
`2026-10-12T07:34:51.582Z`. Counts in the last 7, 21, and 90 days were 694,
2,101, and 7,000. In the last 21 days, 876 of 1,865 story complaints were
recent (46.97%); 1,225 of 5,135 other rows were recent (23.86%). The weekly
complaint report showed 395, 460, and 458 complaints in the later weeks after
earlier weeks mostly around 232–273.

Source totals were Review 3,393, Support 2,049, and Survey 1,558. Sentiment
totals were negative 3,655, positive 3,176, mixed 165, and neutral 4.

## Commands

```powershell
npm test
npm run seed:dry -- --anchor 2026-10-12T08:00:00Z
npm run seed:write -- --anchor 2026-10-12T08:00:00Z
npm run seed:verify -- --anchor 2026-10-12T08:00:00Z
```

`seed:dry` does not connect to MongoDB. The write requires `MONGODB_URI`,
ensures indexes, and upserts the seeded feedback, analyses, and three Adaption
runs. The verify command reports counts, references, date windows, complaint
trends, text search, and sample records. The scripts load `.env` through
`dotenv/config` and never print secret values.

Local validation passed: `npm test` reported 5 tests passed, and `git diff
--check` passed. The case-sensitive audit found all 26 local `require()` paths
in 14 tracked JavaScript files matched their exact tracked filename casing.

## Decisions and known issues

- All generated source/date information is simulated and must be presented as
  such.
- Adaption actual credit spend was not available in the run metadata.
- The labels retest has no evaluation of its own; the recorded evaluation
  belongs to the initial full run.
- Four full-run component-quality values (message 9.16→9.11, completion
  0.97→9.87) came from the owner's instruction because they were absent from
  `data/adaption_run.json`.
- `/health` code returns counts, but the live Render endpoint has not yet been
  checked after redeployment.

## Commits and next step

- `7c92b0f` — realistic simulated dates and sources
- `c112409` — Issue, Report, and AdaptionRun models and indexes
- `a4c2264` — seed the three Adaption runs
- `5ad0a56` — detailed seed verification reporting
- `1125eb4` — collection counts in `/health`

**Next:** check `https://<your-service>.onrender.com/health` after the push and
Render redeploy, then proceed with **Phase 3: app shell and feedback
management**.
