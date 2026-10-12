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

**Current phase: Phase 1 — complete. Phase 0 is reported complete by the
owner.**

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

Full-run estimate response: `estimated_credits_consumed: 4.0`,
`estimated_minutes: 14`, `estimatedCreditsConsumed: 4`,
`estimatedMinutes: 14`. The owner explicitly approved the estimate before the
full run was launched.

## 13. Phase 1 completion report

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

## 7. Phase roadmap and handoff

- **Phase 0 — setup/accounts:** repo, dependencies, Express/EJS shell, Atlas,
  secrets in environment only, early deployment. Owner says complete.
- **Phase 1 — Adaption pipeline:** unique reviews, approved taxonomy, Python
  environment and connection, smoke estimate/run, full estimate/run, evaluation,
  validated adapted analysis, run metadata, unknowns documented.
- **Phase 2 — data layer/seeding:** Mongoose models, deterministic simulated
  sample timestamps/source, seed 7,000 feedbacks plus 320 unique analyses,
  indexes, count verification.
- **Phase 3 — app shell/feedback management:** responsive layout, feedback
  table/forms, CSV preview/validation/import, sample data.
- **Phase 4 — runtime analysis:** hash cache, similar adapted examples,
  controlled-schema LLM analysis, validation, fallback, producer badge.
- **Phase 5 — dashboard:** aggregated KPIs, sentiment/topic charts, trends,
  consistent shared filters, simulated-date disclosure.
- **Phase 6 — priorities/recommendations:** explainable score, evidence quotes,
  grounded recommendations with a fallback.
- **Phase 7 — issue tracking/reports:** status, owner, notes, report snapshot,
  public share token, print-to-PDF.
- **Phase 8 — Adaption page/polish:** visible pipeline, status and quality,
  accessibility, mobile and failure-state polish.
- **Phase 9 — deploy/submission:** production seed/env check, responsive test,
  README, demo, truthful Adaption write-up, submit early.

After a phase, commit only reviewed intended files, update the progress log,
record decisions/contract changes/known issues, and include a concise phase
report: files, run/verification commands, contract changes, issues, and exact
next step. Before pushing, inspect `git status`, stage explicitly, and ensure
no secrets or temporary outputs are staged.

Open decisions not yet resolved in the supplied project context: which free
runtime LLM provider to use (Gemini Flash was the default candidate), whether
Adaption credits are visible in the account, the 48-hour start/deadline, and
Render versus Railway hosting. Do not invent answers.
