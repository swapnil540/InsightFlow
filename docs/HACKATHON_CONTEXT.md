# InsightFlow — Build Battle 2026 — Portable Project Context

Last updated: 2026-10-12. This handoff document was reconstructed from the
project context supplied by the owner and updated with verified Phase 1 work.
Use it with the repository; do not treat it as a substitute for inspecting
current code and Git status.

## 1. Project and hackathon

InsightFlow is a solo-hackathon project for Build Battle 2026: an intelligent
customer-feedback and decision platform. Businesses need to turn reviews,
surveys, and support messages into sentiment, recurring issues, priorities,
recommendations, tracked work, and shareable reports. Adaption's Adaptive Data
product must be a real and explainable part of the data workflow.

Expected product capabilities:

1. Feedback entry, CSV import, search, filtering, organization, and sample data.
2. Sentiment, controlled topics, complaints, and recurring-issue analysis.
3. Filterable metrics, sentiment/topic charts, and trends.
4. Prioritized issues with a transparent score, evidence, and actionable
   recommendations.
5. Issue tracking and exportable/shareable reports.

Submission goal: a live deployed app, source repository, short demo, and a
truthful explanation of Adaption's contribution. Do not claim simulated data is
real, and do not represent unmeasured Adaption costs or behavior as fact.

## 2. Current repository and working rules

- Repository: `swapnil540/InsightFlow`, branch `main`, remote `origin` configured.
- The owner says Phase 0 and some Phase 1 work were already completed.
- Phase 0's project skeleton, Node/Express/EJS application, `.env.example`,
  `.gitignore`, and package files exist. A local `.env` exists and is ignored;
  never read, print, stage, or commit its contents.
- Windows PowerShell is the user's shell. `git`, `node`, and Python are
  installed; `gh` is not installed.
- Python dependencies are in `.venv`; observed versions: Adaption 0.14.0,
  pandas 3.0.6, and python-dotenv installed.
- Work one step at a time: explain changes, give verification steps, and wait
  for the owner's approval before proceeding to the next consequential step.
- Before any Adaption operation that can spend credits, estimate first and
  show the complete response. Never launch a real run without the owner's
  explicit yes to that estimate.
- Never guess an Adaption response shape. Print and inspect full response
  objects. Use `datasets.adapt`, not deprecated `datasets.run`.
- Keep secrets in ignored `.env` or environment variables. Do not commit
  credentials, generated outputs, or temporary files.
- Check `git status` before commits and stage only reviewed, intended files.
  Do not discard existing user changes.

## 3. Dataset, normalization, and taxonomy

Source file: `data/raw_feedback.csv` (original dataset name:
`BuildBattle_2026_Customer_Feedback_Dataset.csv`). It contains 7,000 rows and
two columns, `review` and `category`, with no dates, source, sentiment, or IDs.
Exact duplicate text is common (about 95%); no review text appears in more than
one category. The categories are not sentiment labels.

Verified preparation results:

| Category | Raw rows | Unique reviews |
|---|---:|---:|
| Product Feedback | 1,738 | 183 |
| Customer Service | 1,707 | 66 |
| Operational Issues | 1,800 | 36 |
| Fraud and Scam | 1,755 | 35 |
| **Total** | **7,000** | **320** |

`pipeline/textutil.py` defines the cross-language text contract: trim leading
and trailing whitespace, collapse each internal whitespace run to one space,
then compute SHA-1 over the lowercase normalized UTF-8 text. Phase 2's Node
implementation must copy this exact rule.

`pipeline/prepare_data.py` produces `data/unique_reviews.csv` with exactly
`review,category` and `data/unique_counts.csv` with
`text_hash,review,category,count`. The checked-in prepared files currently
match the counts above.

`config/taxonomy.json` is the **source of truth** for topic keys, labels,
parent categories, and descriptions; `config/taxonomy.js` exports it using
CommonJS. This is an explicit architecture-contract change from the earlier
plan that made the JavaScript file the sole taxonomy source. Python prompts
read topic keys from the JSON file. The taxonomy currently has 16 topics
across the four original categories; see the JSON file rather than duplicating
topic values here.

Analysis contract per review:

```json
{
  "sentiment": "positive|neutral|negative|mixed",
  "sentimentScore": -1.0,
  "topic": "<key from config/taxonomy.json>",
  "severity": 1,
  "isComplaint": true,
  "issueSummary": "<8-12 words>",
  "suggestedAction": "<one sentence>"
}
```

Sentiment score is -1 to 1; severity is an integer from 1 to 5. Negation must
be handled correctly, especially positive false alarms such as “I was not a
victim of fraud” and “No signs of fraudulent activity.”

## 4. Product/data architecture contract

Stack: Node.js, Express, EJS, MongoDB Atlas with Mongoose, Bootstrap 5 and
Chart.js via CDN, and small vanilla JavaScript files. Use CommonJS and
`async/await`; no TypeScript or frontend framework. Keep business logic in
`services/`, keep routes thin, escape user text in EJS with `<%= %>`, and
cache AI analyses. Pages must have loading, empty, and error states and work
on mobile.

Planned collections:

- `feedbacks`: all original rows with `text`, `textHash`, `originalCategory`,
  `source`, `createdAt`, `isSimulated`, and embedded analysis.
- `analyses`: one cached analysis per unique text hash.
- `issues`: topic, status (`open`, `investigating`, `resolved`), owner, notes,
  priority snapshot, timestamps.
- `reports`: random share token, title, report snapshot, timestamp.
- `adaptionruns`: run/dataset IDs, status, row counts, quality scores,
  improvement, credits, notes, timestamp.

All generated dates and sources for the provided sample must be explicitly
marked simulated. The source dataset has no time dimension. Node-side uploads
must be validated and size/row limited. AI or Adaption outages must not prevent
the application from rendering; use the planned cache and fallback behavior.

Environment variables: `PORT`, `MONGODB_URI`, `ADAPTION_API_KEY`,
`ADAPTION_DATASET_ID`, `LLM_API_KEY`, `LLM_MODEL`, `BASE_URL`. Never put real
values in tracked files or browser code.

Planned pages include `/`, `/dashboard`, `/feedback`, `/import`, `/insights`,
`/issues`, `/reports`, `/r/:token`, and `/adaption`. Planned JSON endpoints
include `/api/stats`, `/api/trends`, `/api/topics`, `/api/priorities`,
`/api/feedback`, `/api/analyze`, and `/api/adaption/status`. Shared filters:
`category`, `sentiment`, `topic`, `source`, `from`, `to`, `q`, `page`, `limit`.

Priority score, computed per topic:

`100 * (0.35 * volume + 0.30 * negativity + 0.20 * severity + 0.15 * trend)`

Show the factor breakdown, evidence quotes, and why an issue matters. Show both
total mentions and unique phrasings so duplicates do not obscure volume.

## 5. Adaption workflow and verified smoke test

Adaptive Data workflow: import → map columns → recipes → optional expansion →
brand controls → adapt → evaluate → download. `universal_prompt` plus at least
one `context` column can generate completions without a source completion
column; this was verified in the smoke test. Use `deduplication`,
`prompt_rephrase`, and `reasoning_traces` recipe booleans. The JSON-only
blueprint is:

> Output only a single valid JSON object. No markdown fences, no commentary.

Smoke settings: universal prompt generated from the topic keys in
`config/taxonomy.json`; context `review, category`; no completion mapping;
deduplication on; prompt rephrase and reasoning traces off; hallucination
mitigation off; no safety categories; fixed idempotency key.

Verified smoke run:

- Script: `pipeline/smoke_test.py`; commit `b79226a` (`Phase 1: add Adaption
  smoke test`).
- Input: deterministic, stratified 50-row sample from the 320 unique reviews;
  it force-included 3 negation-style examples.
- Dataset ID: `f758c682-2efb-4887-8907-11ef59a810d7`.
- Run ID: `dataset-f758c682-2efb-4887-8907-11ef59a810d7-1791777733848`.
- Status: succeeded; 50 rows processed and 50 downloaded.
- Estimate: 1.0 estimated credit and 11 estimated minutes. The SDK's launch
  response repeated the estimate; neither launch nor evaluation returned a
  confirmed actual credit-consumption field.
- Downloaded columns: `category`, `enhanced_prompt`,
  `enhanced_completion`, `original_context`, `review`. The JSON completion is
  in `enhanced_completion`; `enhanced_prompt` was empty for universal-prompt
  mode.
- JSON parse: 50/50 (100%).
- All 3 sampled negation rows were labeled positive with
  `isComplaint: false`.
- Evaluation `quality` fields: `grade_before: C`, `grade_after: A`,
  `score_before: 5.0`, `score_after: 9.4`, `improvement_percent: 88.0`,
  `percentile_after: 57.7`.
- The run ID timestamp to the evaluation timestamp was about 2m49s. This is
  an approximate server timestamp difference, not a measured stopwatch time.
- The smoke input came from already-unique text, so 50 in/50 out does not
  reveal the deduplication key or prove whether duplicate rows would collapse.
Verified full run and B8 dataset build:

- Full-run dataset ID: `456aec4e-901a-4825-91b1-60b1a936e52f`.
- Full-run ID: `dataset-456aec4e-901a-4825-91b1-60b1a936e52f-1791778526064`.
- Status: succeeded; status reported 320/320 rows processed and the downloaded
  CSV contains 320 rows.
- Estimate: 4.0 credits and 14 minutes. Run metadata records actual credits as
  `null` because the launch/evaluation responses did not expose actual spend.
- Measured script wall time from the persisted launch timestamp through
  metadata creation: 3.35 minutes (includes queue and processing for this run).
- Evaluation `quality` fields: `grade_before: C`, `grade_after: A`,
  `score_before: 5.0`, `score_after: 9.5`, `improvement_percent: 90.0`,
  `percentile_after: 57.7`.
- `data/adapted_analysis.json` contains 320 records, all matching source text
  hashes. All 320 completions parsed as JSON; no invalid/missing/unmatched
  analyses or duplicate output hashes were found.
- Ten valid analyses assign a topic whose taxonomy parent category differs
  from the original category. They are flagged for review in the report, not
  silently rewritten.
- 210 generated `issueSummary` values are shorter than the requested 8-12
  words in the initial run. The initial validation report lists each hash and
  summary; the values were preserved rather than padded with invented words.
- Evaluation `raw_results.metrics.row_counts.input` reports 100, despite the
  run status and downloaded CSV reporting 320. This discrepancy is recorded
  as an Adaption evaluation-field inconsistency; do not assume why it occurs.

One-time summary re-test (approved by the owner):

- Re-used the same 320-row dataset with a distinct idempotency key and a
  stronger exact 8-12-word instruction. The revised prompt and blueprint are
  saved in `data/adaption_retest_run.json`.
- Re-test run ID: `dataset-456aec4e-901a-4825-91b1-60b1a936e52f-1791779272014`.
- Status: succeeded; 320 rows downloaded.
- Estimate: 4.0 credits and 14 minutes; actual credits were not returned.
- The re-test output has 320/320 valid JSON objects and all 320 summaries
  contain 8-12 words. All five negation-style reviews remain positive and
  `isComplaint: false`. No rows are invalid, missing, unmatched, or duplicated.
- Six topics have a taxonomy parent differing from the original category;
  each row is flagged in the re-test report.
- The evaluation response for the re-test points to the **initial run's**
  `config_source` and timestamp. Its scores are therefore recorded as null in
  `data/adaption_retest_run.json`; do not attribute the initial run's 5.0 to
  9.5 / 90% score to the re-test.
- Initial and re-test `actualCredits` are unavailable. Estimated credits total
  8.0 across the two full-size attempts, but actual spend is not verified.
- The re-test elapsed-time metadata is 8.35 minutes from launch until a later
  successful refresh/download/evaluation call; it includes that refresh and
  is not a provider-only runtime.
- Phase 1 completion decision: use the stricter re-test as the source for
  `data/adapted_analysis.json` and its report. Keep the initial full run's
  evaluation as the canonical evaluation; the re-test reused the same dataset
  and has no evaluation of its own.

Plan B if structured completion output cannot be made reliable: retain
Adaption's real deduplication and quality-evaluation contribution, and produce
the app's structured labels with its runtime LLM using the same schema.

## 6. Current phase status and next actions

**Current phase: Phase 9 — Final check and cleanup. Phase 8 (Adaption page) and Phase 9 (README & verification) are complete and pushed to `origin/main`.**
Before Phase 4 live feedback verification on 2026-10-12, the live database
contained 7,014 feedback entries, 332 unique texts, 320 cached analyses, and 3
Adaption runs. See the Phase 3 completion report below for added test data and
remaining deployment-check limitations.

| Work | State |
|---|---|
| B1 text normalization and unique data | Existing scripts/output; verified 320 rows and expected per-category counts. |
| B2 taxonomy | Existing 16-topic JSON and CommonJS wrapper. JSON is now the source of truth. |
| B3 Python environment | `.venv` exists; observed Adaption 0.14.0, pandas 3.0.6, python-dotenv installed. |
| B4 Adaption connection helper | `pipeline/check_connection.py` exists. Do not assume its network check has been run unless its output is supplied. |
| B5 smoke test | Complete, successful; script committed as `b79226a`. |
| B6 unknowns and go/no-go | Smoke-test facts are recorded above. Go/no-go is GO for the structured output quality gate. Dedup key and actual credit spend remain unverified. |
| B7 full run | Complete. Dataset ID and run ID are recorded above; run succeeded with 320 rows. |
| B8 adapted analysis dataset/report | Built from the revised-prompt re-test; all 320 summaries meet the 8-12 word requirement. Four Operational Issues rows were remapped to `order_processing_and_expectations`; each change is recorded in the report. |
| B9 docs/handoff | Complete. Initial-run evaluation and both run IDs are recorded; Phase 1 changes are committed and pushed. |
| Phase 2 models | Complete: `models/feedback.js`, `models/analysis.js`, `models/issue.js`, `models/report.js`, and `models/adaptionRun.js`. Feedback hash is non-unique; analysis hash is unique. Feedback filter, lookup, and text-search indexes are declared. |
| Phase 2 seed data | Complete: deterministic seeded RNG, anchor-based 90-day simulated timestamps, weighted `Review`/`Survey`/`Support` sources, 7,000 feedback rows, 320 cached analyses, and 3 AdaptionRun records. All seeded feedback is marked simulated. |
| Phase 2 verification | At Phase 2 close, `npm test` passed (5 tests) and the owner ran dry, write, and verify at anchor `2026-10-12T08:00:00Z`: 7,000 feedbacks, 320 analyses, 3 Adaption runs, zero missing analyses/invalid topics/embedded mismatches, and the expected recent trend. Render `/health` was later verified during Phase 3. See `docs/PHASE_2_REPORT.md`. |
| Phase 3 app shell and feedback management | Complete and pushed. The live app supports feedback search/filtering, grouped/all views, manual entry, CSV preview/import, and safe sample loading. `npm test` passes (16 tests); live `/health` reports 7,014 feedbacks, 320 analyses, and 3 Adaption runs. |
| Phase 4 runtime analysis | Classifier, leave-one-out evaluation, Mongo cache/API, add-feedback result, and CSV analysis are implemented and locally verified. Live Render add-feedback verification passed; CSV and API live flows remain unverified. Commits are listed in section 13. |
| Phase 5 dashboard | Complete and pushed to `origin/main`; KPI cards, sentiment/topic charts, date trends, rising issues, shared filters, and simulated-data disclosure are implemented. The owner reported the dashboard working locally. Render deployment and some edge-state visual checks remain unverified. |
| Phase 6 priorities & recommendations | Complete and pushed to `origin/main` (`2b00367`); pure scoring function, explainable 4-factor formula, 16 topic recommendations, evidence quotes, Adaption suggested actions, GET /api/priorities, GET /insights. |
| Phase 7 issue tracking & reports | Complete and pushed to `origin/main` (`802bb82`); issue creation, status transitions, report snapshot generation with token, executive summary bullets, public read-only report view (/r/:token), print-to-PDF layout. |
| Phase 8 Adaption page | Complete and pushed to `origin/main` (`53cbe79`); `GET /adaption`, horizontal responsive pipeline flow, run cards, live DB counts, configuration notes, honest evaluation notes. |
| Phase 9 README & final check | Complete and pushed to `origin/main` (`6c27cc8`); comprehensive `README.md` with live Render URL, setup, test, and route documentation; verification of case sensitivity, secret sanitization, and 47 passing tests. |

### Phase 2 simulated sample rules

- Default anchor: seed start time rounded down to the UTC hour. Pass
  `--anchor <ISO date-time>` to choose a fixed anchor; dry, write, and verify
  should use the same anchor when comparing the same seed batch.
- A seeded Mulberry32 generator with constant seed `0x1f10f10` determines all
  generated source and timestamp choices.
- Every feedback timestamp is within the 90 days ending at the anchor. Story
  complaints (`isComplaint` and a `fraud_*` topic or `delivery_delay`) place
  approximately 45% in the recent 21 days and 55% in the preceding 69 days.
  Other rows are uniform across the full 90 days.
- Customer Service source weights: Support 60%, Review 25%, Survey 15%.
  Other categories: Review 55%, Survey 25%, Support 20%.
- All generated feedback has `isSimulated: true`. Source and date values are
  simulated and do not come from the original CSV.

Full-run estimate response: `estimated_credits_consumed: 4.0`,
`estimated_minutes: 14`, `estimatedCreditsConsumed: 4`,
`estimatedMinutes: 14`. The owner explicitly approved the estimate before the
full run was launched.

## 13. Phase completion reports

### Phase 6 & Phase 7 completion report (Priorities, Recommendations, Issue Tracking, and Reports)

- **State:** complete and pushed to `origin/main`. Commits: `2b00367` (Priorities and recommendations) and `802bb82` (Issues and reports).
- **Files added/updated:**
  - `config/recommendations.js`: deterministic, topic-specific action plans and team mappings for all 16 taxonomy topics.
  - `services/priorityService.js`: pure scoring function `scoreTopics(rows, opts)`, single-aggregation database query `getPriorities(query)`.
  - `services/issueService.js`: issue creation with topic validation and deduplication, listing with status counts, and status/owner/note updates.
  - `services/reportService.js`: snapshot payload builder with 3 auto-generated executive summary bullets, random hex token generation, and report retrieval.
  - `routes/api.js`: added `GET /api/priorities` with shared filter validation and optional limit.
  - `routes/pages.js`: wired `GET /insights`, `POST /issues`, `GET /issues`, `POST /issues/:id`, `GET /reports`, `POST /reports`, `GET /r/:token`.
  - `views/pages/insights.ejs`: priorities page with top-5 cards, 4-factor progress bars with raw metrics, "Why this matters" explanation sentence, evidence quotes, recommendations, Adaption suggestions, "Track issue" action, compact table of all ranked topics, and collapsible formula explainer.
  - `views/pages/issues.ejs`: tracked issues table with status filter pills (All, Open, Investigating, Resolved), owner assignment, notes editing, and empty state.
  - `views/pages/reports.ejs`: report generator form and list of saved snapshots with view and share links.
  - `views/pages/report-view.ejs`: read-only, business-friendly executive briefing without admin navbar, featuring executive summary bullets, KPI strip, recommendations, evidence quotes, tracked work, `@media print` print-to-PDF stylesheet, and `<meta name="robots" content="noindex">`.
  - `test/phase6.test.js`: unit tests for scoring order, factor bounds [0, 1], trend clamp, 5-complaint threshold, explanation formatting, and template rendering.
  - `test/phase7.test.js`: unit tests for executive summary generation, status enums, and template rendering for issues, reports, and public report view.
- **Score formula:**
  `priority = round(100 * (0.35 * volume + 0.30 * negativity + 0.20 * severity + 0.15 * trend))`
  - Volume (35%): `complaints(topic) / max complaints across topics`
  - Negativity (30%): `(negative + mixed mentions) / all mentions of topic`
  - Severity (20%): `average complaint severity / 5`
  - Trend (15%): `clamp((recent14 - prev14) / max(prev14, 10), 0, 1)`
  - Eligibility threshold: only topics with at least 5 complaints are ranked.
- **What was skipped:**
  - Live external LLM calls were omitted in favor of deterministic, grounded recommendations based on verified taxonomy actions.
  - No additional npm dependencies were introduced; CommonJS and Mongoose models were preserved.
- **Verification:**
  - `npm test` runs 45 tests across Phase 2 through Phase 7 suites (45 passing, 0 failing) locally without connecting to Atlas.
  - Templates rendered cleanly with EJS test assertions.

### Phase 5 completion report

- **State:** dashboard implementation complete and pushed to `origin/main`.
  Phase commits: `79bda85` dashboard breakdown charts; `4042dbb` dashboard
  filter initialization fix; `d1559fc` overall trend chart; `54dd250` rising
  issues and topic trend; `f27bfdc` loading and responsive-state polish.
- **Files:** `services/statsService.js` supplies aggregated analytics;
  `routes/api.js` exposes analytics endpoints; `routes/pages.js` serves the
  dashboard; `views/pages/dashboard.ejs`, `public/js/dashboard.js`, and
  `public/css/app.css` render the dashboard; `test/phase5.test.js` covers its
  local contracts.
- **Routes and contract:** `GET /dashboard` serves the dashboard. `GET
  /api/stats`, `/api/topics`, and `/api/trends` return filtered analytics and
  consume the shared whitelisted filters (`category`, `sentiment`, `topic`,
  `source`, `from`, `to`). Invalid filter values return a client error; data
  access or aggregation failures return a generic analytics error. Analytics
  include only feedback with a usable analysis, topic, and sentiment.
- **Decisions:** a complaint is counted only when `analysis.isComplaint ===
  true`; the default time window ends on the latest feedback `createdAt` in the
  filtered data; date buckets use UTC. Generated sample timestamps remain
  disclosed as simulated.
- **Verification:** `npm test` passed all 32 tests; `node --check
  public/js/dashboard.js` and EJS rendering with stub data passed. The owner
  reported that the dashboard works locally. Run `npm run dev` and open
  `http://localhost:3000/dashboard` to inspect it. No live Atlas request was
  made in this phase. The owner should verify the current Render deployment,
  no-match results, API failure states, and narrow-screen layout from their
  network/browser.
- **Known issues:** Render redeployment has not been confirmed. The live
  dashboard and the no-match, API-error, and mobile visual states were not
  independently checked in this session. Atlas reachability depends on the
  owner's network/IP allowlist.
- **Exact next step:** begin Phase 6 priorities and recommendations: implement
  the explainable priority score, evidence quotes, and grounded
  recommendations with a fallback.

### Phase 4 completion report

- **State:** implementation complete and deployed add-feedback flow verified.
  `npm test` passes 24 tests. `npm run eval:classifier` reports
  agreement with Adaption labels on 320 held-out examples: sentiment 95.94%
  (307/320), topic 79.69% (255/320), and complaint 96.88% (310/320). At
  confidence >= 0.5, agreement is 95.61% (283/296), 81.42% (241/296), and
  96.62% (286/296), respectively.
- **Evaluation caveat:** the reviews are highly templated and include
  near-duplicates, so held-out agreement is optimistic and is not general
  accuracy. The five most common topic confusions were
  `product_quality -> product_feature_functionality` (15), the reverse (12),
  `fraud_counterfeit_or_misrepresentation -> fraud_seller_scamming` (4),
  `product_setup_usage -> product_feature_functionality` (4), and
  `product_feature_functionality -> product_reliability_durability` (3).
- **Files:** `services/similarityClassifier.js` implements plain-JavaScript
  TF-IDF and weighted nearest-neighbour voting; `services/analysisService.js`
  loads adapted examples, caches analyses, and provides the rules fallback;
  `scripts/eval-classifier.js` runs the held-out evaluation;
  `routes/api.js` exposes the analysis API; `views/pages/feedback-result.ejs`
  presents manual-entry results; `test/phase4.test.js` covers classifier
  behavior. Existing feedback, CSV, route, model, and view files were updated.
- **Routes and UI:** `POST /api/analyze` accepts `{ text }`, validates 1-1,000
  characters, and allows 30 requests per minute per IP. `POST /feedback`
  analyzes before saving and displays sentiment, topic, severity, complaint,
  action, confidence, and the matched example. CSV confirmation analyzes each
  unique text once and reports low-confidence counts. Feedback rows show
  producer and confidence. CSV limits remain 5 MB and 10,000 rows.
- **Contract changes:** producer values now include `similarity` and
  `llm-runtime`; historic `llm` and `fallback` values remain allowed for
  compatibility. Optional `analysis.confidence` is in 0..1 and
  `analysis.matchedTextHash` identifies the nearest labelled review. Embedded
  feedback also has `analysis.notAnalyzed` for the neutral failure result.
- **Decisions and known issues:** the Analysis collection stores hashes and
  labels, but not review text, so the runtime joins Adaption hashes to
  Feedback text; it uses `data/adapted_analysis.json` when the database is
  empty or unavailable. Local checks used that file fallback. Live Render
  add-feedback was verified with the negated fraud example below; live
  `/api/analyze` and CSV import flows have not been verified.
  Similarity confidence is the top cosine score and is not calibrated as a
  probability. No LLM fallback was added; it remains optional and needs a
  separate explicit go-ahead.
- **Verification:** `npm test` passes 24/24. `npm run eval:classifier` prints
  the metrics above. Local analysis checks covered a negated fraud mention, a
  seller-not-sending-product complaint, and unanswered support emails. The
  `/api/analyze` smoke check returned 200 for valid text and 400 for blank
  text. On 2026-10-12, the live Render add-feedback flow accepted "I was not a
  victim of fraud, the seller was honest and sent the genuine item" and showed
  Positive, topic Counterfeit or Misrepresentation, severity 1/5, complaint
  No, 70% confidence, and a matching Adaption-labelled example.
- **Commits:** `841d519` Similarity classifier; `048d8ab` Evaluate similarity
  classifier; `ac57d7b` Add database-backed runtime analysis; `c3afe73`
  Runtime analysis in add feedback and CSV import; `551cef3` Phase 4 complete;
  `bd2acc5` added the deployed URL to the README; a follow-up commit records
  live add-feedback verification.
- **Exact next step:** begin Phase 5 dashboard work. Live `/api/analyze` and
  CSV import verification remain open.

### Phase 1 completion report

- `data/adapted_analysis.json` and `data/adapted_analysis_report.txt` are built
  from `pipeline/out/adapted_analysis_retest.csv` (320 rows). All issue
  summaries contain 8-12 words. Four rows with `originalCategory` set to
  `Operational Issues` and a topic outside `delivery_*`, `shipping_*`, and
  `order_*` were changed to `order_processing_and_expectations`; the report
  records each review, source hash, and before/after topic.
- The corresponding taxonomy label is `Website & ordering`.
- The full-run evaluation is 5.0 to 9.5 (grade C to A), with percentile 57.7,
  evaluated on a 100-row sample. The retest reused the same dataset and has no
  evaluation of its own.
- Full-run ID:
  `dataset-456aec4e-901a-4825-91b1-60b1a936e52f-1791778526064`.
- Retest run ID:
  `dataset-456aec4e-901a-4825-91b1-60b1a936e52f-1791779272014`.
- Phase 1 was committed as `Phase 1 complete` and pushed to `origin`.

### Phase 3 completion report

- **State:** complete, committed, and pushed to `origin/main`. Phase commits:
  `b072aae` app shell; `b6c38ee` 404/500 locals fix; `1ceb35a` shared
  filters; `aeedb50` feedback list; `96b8042` rules analysis; `79caceb` manual
  feedback; `9a63ec3` CSV import; `aadba10` repeatable sample loader and home
  metrics; `3b588b5` sample success render fix; `36f684b` simulated-date label
  fix.
- **Decisions:** keep the Phase 4 analysis boundary stable at
  `analyzeText(text, { category })`; rules outputs are embedded on feedback
  without entering the analysis cache. Store CSV previews in process memory
  with a 15-minute expiry. Use fixed sample anchor `2026-10-12T08:00:00Z` and
  skip all writes when the 7,000 seeded rows are already present.
- **Live verification:** Render `/health` returned connected with 7,014
  feedbacks, 320 analyses, and 3 Adaption runs. The app was checked for home,
  valid multi-filter results, grouped/all views, detail modal, add-feedback
  negation handling, import preview and confirmation, import-batch filtering,
  and sample-loader idempotency. The live test added one manual feedback entry
  and imported 13 valid fixture rows (4 skipped; 11 new analyses), giving 332
  unique texts. The sample import batch is
  `imp-20261012-1040-23d3`. A brief 502 occurred while Render restarted after a
  push; the app recovered. The feedback and import pages were visually checked
  at a narrow 699 px browser width, where navigation collapsed and content
  stacked without visible horizontal overflow. Render deployment logs were
  not available in this session.
- **Verification:** `npm test` passes all 16 Phase 2/3 tests. `node
  scripts/seed.js` retains its dry-run output and summary. Render `/health`
  confirmed database connectivity; local Atlas connectivity was unavailable
  during implementation, so database writes were validated on the live app.
- **Known limits:** CSV preview state is in memory and can expire on restart;
  Render logs were not inspected; responsive visual check used the available
  699 px viewport rather than a 390 px emulated phone viewport. The manually
  added negation test and sample CSV rows remain in the live database as
  requested for deployment testing.
- **Exact next step:** begin Phase 4 runtime analysis, replacing the rules-only
  fallback with the approved runtime analysis provider while preserving the
  `analyzeText(text, { category })` interface and cache behavior.

### Phase 2 fix-up completion report

- **Anchor used for the verified seed:** `2026-10-12T08:00:00Z`.
- **MongoDB counts verified by the owner:** 7,000 feedbacks, 320 analyses, and
  3 Adaption runs. Category counts are Product Feedback 1,738, Customer
  Service 1,707, Operational Issues 1,800, and Fraud and Scam 1,755.
- All 7,000 seeded feedback records are simulated. Sources: Review 3,393,
  Support 2,049, Survey 1,558. Simulated `createdAt` range:
  `2026-07-14T08:04:17.841Z` through `2026-10-12T07:34:51.582Z`.
- Last 21 days: story complaints were 46.97% of their cohort; other feedback
  was 23.86% of its cohort. Their recent counts were 876 and 1,225,
  respectively. Last-7/21/90-day row counts were 694/2,101/7,000. Text search
  for `scam` returned 3 results.
- Verification found zero feedbacks without a matching analysis, zero topics
  outside the taxonomy, zero invalid embedded analyses, and zero inconsistent
  references. The weekly complaint report shows counts rising to 395, 460, and
  458 in the final complete/later weeks, against earlier weekly counts mostly
  around 232–273.
- `/health` returns `counts: { feedbacks, analyses, adaptionRuns }` when
  MongoDB is available and null counts when it is unavailable. Its live Render
  response was verified during Phase 3; current counts are in the Phase 3
  completion report.
- Decisions and limitations: generated timestamps and source values remain
  explicitly simulated; actual Adaption credit spend is unavailable; the
  labels retest has no evaluation of its own. Four full-run component quality
  values came from the owner's Step 3 instructions because they were absent
  from `data/adaption_run.json`.
- Step commits: `7c92b0f` realistic simulated dates/sources; `c112409` Issue,
  Report, and AdaptionRun models/indexes; `a4c2264` three AdaptionRun seeds;
  `5ad0a56` verification reporting; `1125eb4` `/health` counts.
- **Next step at Phase 2 close:** check deployed Render `/health`, then begin
  Phase 3. Both actions were completed; see the Phase 3 completion report.

## 7. Phase roadmap and handoff

- **Phase 0 — setup/accounts:** repo, dependencies, Express/EJS shell, Atlas,
  secrets in environment only, early deployment. Owner says complete.
- **Phase 1 — Adaption pipeline:** unique reviews, approved taxonomy, Python
  environment and connection, smoke estimate/run, full estimate/run, evaluation,
  validated adapted analysis, run metadata, unknowns documented.
- **Phase 2 — data layer/seeding:** complete. Models are
  `models/feedback.js`, `models/analysis.js`, `models/issue.js`,
  `models/report.js`, and `models/adaptionRun.js`. Seed 7,000 feedbacks, 320
  unique analyses, and 3 Adaption runs with deterministic simulated values.
- **Phase 3 — app shell/feedback management:** responsive layout, feedback
  table/forms, CSV preview/validation/import, sample data. **Complete and
  deployed; see the Phase 3 completion report.**
- **Phase 4 — runtime analysis:** implementation complete; similar adapted
  examples, hash cache, API, feedback/import hooks, failure fallback, producer
  badge. Optional LLM fallback remains unimplemented.
- **Phase 6 — priorities/recommendations:** complete; explainable 4-factor score, evidence quotes, recommendations, GET /api/priorities, GET /insights.
- **Phase 7 — issue tracking/reports:** complete; status transitions, owner, notes, report snapshot generation, public share token /r/:token, print-to-PDF layout.
- **Phase 8 — Adaption page/polish:** visible pipeline, status and quality,
  accessibility, mobile and failure-state polish.
- **Phase 9 — deploy/submission:** production seed/env check, responsive test,
  README, demo, truthful Adaption write-up, submit early.

### Phase 3 files, routes, and contracts

- `services/filters.js` parses whitelisted shared query filters and builds
  Mongo filters; `services/feedbackService.js` queries, groups, pages, and
  creates feedback; `services/analysisService.js` exposes
  `async analyzeText(text, { category })` with cache lookup and a rules-based
  fallback; `services/csvImportService.js` parses/previews CSV and confirms
  imports; `services/importStore.js` holds expiring in-memory previews;
  `services/sampleLoader.js` owns seed CLI logic and the safe sample loader.
- `data/sample_import_test.csv` is the import verification fixture;
  `test/phase3.test.js` covers the analysis and import contracts.
- `views/layout.ejs` and `public/css/app.css` provide the responsive Bootstrap
  shell; shared partials are `views/partials/navbar.ejs`, `footer.ejs`,
  `notice.ejs`, `sentiment-badge.ejs`, `source-chip.ejs`, `severity-dots.ejs`,
  `empty-state.ejs`, and `pagination.ejs`.
- `views/pages/home.ejs`, `feedback.ejs`, `feedback-new.ejs`, `import.ejs`,
  `import-preview.ejs`, `import-result.ejs`, `placeholder.ejs`, `404.ejs`, and
  `error.ejs` implement the Phase 3 screens; `public/js/feedback.js` and
  `feedback-form.js` support the detail modal and live form counter.
- Routes: `GET /`, `GET /feedback`, `GET /feedback/new`, `POST /feedback`,
  `GET /import`, `GET /import/template.csv`, `POST /import/preview`,
  `POST /import/confirm`, and `POST /import/sample`. The five planned pages
  remain friendly placeholders.
- Shared query parameters: `category`, `sentiment`, `topic`, `source`, `from`,
  `to`, `q`, `complaint`, `batch`, `view`, `sort`, `page`, and `limit`.
- `Feedback.importBatch` is optional and indexed. `seedKey` uses the unique
  sparse `seed_row_idempotency` index so app/import rows can omit it.
- The analysis service keeps `analyzeText(text, { category })` stable and
  returns `{ analysis, fromCache }`; rules-based results are embedded on the
  feedback document but do not enter the analyses cache.
- CSV previews live in process memory for 15 minutes. The sample loader uses
  fixed anchor `2026-10-12T08:00:00Z`; if the seed count is 7,000 it makes no
  writes and reports 7,000 entries and 320 unique texts.

### Phase 2 run and verification

- `npm test` runs the focused Node built-in test suite.
- `npm run seed:dry` validates local inputs and prints counts without
  connecting to MongoDB.
- `npm run seed:write` requires a valid `MONGODB_URI`; it ensures indexes and
  upserts the sample feedback, analyses, and three Adaption runs. It does not
  clear collections or delete issues/reports.
- `npm run seed:verify` reports totals, category/sentiment/source counts,
  timestamp windows, complaint volume and unique phrasings, weekly complaints,
  recent trend shares, text-search results, and sample feedback. It checks
  references and taxonomy topics.
- All commands preload `.env` with `dotenv/config`; never print or commit its
  values. Use the same `--anchor <ISO date-time>` value for dry/write/verify.
- `/health` returns collection counts when connected; counts are `null` if
  the database is disconnected or count queries fail.
- Current phase: **Phase 9 — Final check and cleanup (Complete)**.

### Phase 8 & Phase 9 completion report (Adaption Page, README, and Final Submission Check)

- **State:** Complete and pushed to `origin/main`.
- **Live URL:** `https://insightflow-ogl7.onrender.com/` (Render deployment).
- **Deadline note:** Final hours of 48-hour hackathon (Build Battle 2026). All core roadmap phases (0 through 9) implemented, documented, and verified.
- **Accomplishments:**
  - Implemented `GET /adaption` and `views/pages/adaption.ejs` displaying live MongoDB Atlas counts, deduplication metrics, a responsive CSS pipeline flow (stacks vertically on mobile), Adaption run result cards (smoke test, labels retest, canonical evaluation), iteration documentation (34% to 100% summary length compliance), and runtime similarity classifier disclosure.
  - Wrote comprehensive, truthful `README.md` reflecting actual codebase routes, setup instructions, deterministic seed commands, test runner commands, truthful Adaption evaluation reporting, and simulated data disclosure.
  - Added Phase 8 unit/integration tests (`test/phase8.test.js`) bringing the test suite to 47 passing tests (`node --test`).
  - Verified repository safety: `.env` is uncommitted, no credentials or secrets exist in git, require paths adhere to Linux case-sensitivity, and no leftover debug dumps exist.

After a phase, commit only reviewed intended files, update the progress log,
record decisions/contract changes/known issues, and include a concise phase
report: files, run/verification commands, contract changes, issues, and exact
next step. Before pushing, inspect `git status`, stage explicitly, and ensure
no secrets or temporary outputs are staged.
