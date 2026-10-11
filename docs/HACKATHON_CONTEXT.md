# InsightFlow — Build Battle 2026 — PORTABLE CONTEXT (v2)

> Paste or attach this whole file to any AI assistant, together with MASTER_PROMPT.md's first-message prompt.
> Last updated: 2026-10-11. Stack: **MongoDB + Express + Node.js + EJS** (the user knows these).
> Section 13 is the progress log. It is the source of truth for "where are we". Update it after every phase.

---

## 0. Instructions for the AI reading this

- The user is an individual participant in a 48-hour hackathon and a computer-branch engineering student. They are familiar with MongoDB, Express, Node.js and EJS.
- Work **one phase at a time** (section 8). Check section 13 to see which phase is current. If the log is empty, start at Phase 0.
- Explain what each piece of code does and why, in plain language. **Hackathon rule: the user must understand and be able to explain every part of their code.** Keep code simple, readable and commented.
- **Respect the contracts in section 7** (folder structure, collections, routes, env vars, analysis JSON schema, conventions). Other AIs work on other phases using the same contracts. If you must change a contract, say so explicitly and tell the user to record it in section 13 under "Contract changes".
- Do not invent facts about Adaption's API. Anything marked VERIFY must be tested with a small run before we build on it.
- Prefer the simplest design that satisfies the requirements and demos well. Working and deployed beats ambitious and broken.
- You cannot see the user's repo. When you need existing code, ask the user to paste the specific files (or the output of `git ls-files`). Do not guess file contents.
- Give complete files with their paths, the exact commands to run, how to verify the result, and what to commit. End each phase with the "Phase report" (section 9).

---

## 1. The hackathon

- **Event:** Build Battle 2026 — AI x Web Development Hackathon, organized by Frontend Arena.
- **Duration:** 48 hours. **Participation:** individual only.
- **Problem statement:** *InsightFlow — Intelligent Customer Feedback & Decision Platform.*
- **Judging criteria:** not published. Likely: working features, meaningful Adaption integration, UI/UX polish, quality of insights, deployment and demo.
- **Submission:** (1) live deployed app, (2) source repo, (3) short demo, (4) brief explanation of the Adaption integration.
- **Rules:** all work inside the 48h window; third-party libs/APIs/AI tools allowed subject to their terms; follow licenses; no plagiarism or misrepresentation; the app must be functional and demonstrable.
- **Tech freedom:** any frontend framework, backend, database, APIs, libraries. Must be responsive with polished UI/UX.

### Problem overview (summary)
Businesses get feedback from reviews, surveys and support messages, but struggle to spot recurring issues, understand sentiment, track change over time, and decide what to fix first. Build a web platform that turns raw feedback into insights and decisions using data and AI.

### Core requirements (verbatim in substance)
1. **Feedback Management** — submit feedback; import a CSV; display, search, filter, organize entries; provide sample data for demo.
2. **AI-Powered Analysis** — identify sentiment, recurring topics, common complaints; group similar feedback into meaningful categories; **use Adaption meaningfully inside the AI/data-processing workflow**.
3. **Analytics Dashboard** — key metrics, sentiment distribution, frequently reported issues; visualize trends/changes over time; filter by category, sentiment or other attributes.
4. **Intelligent Recommendations** — identify high-priority issues from patterns; generate actionable recommendations backed by the data; **explain why** an issue deserves attention.
5. **Reports & Issue Tracking** — save/track important issues; export or share an insight report; present findings in a clear, business-friendly format.

---

## 2. The dataset (analyzed)

File: `BuildBattle_2026_Customer_Feedback_Dataset.csv`

- 7,000 rows, 2 columns: `review` (text), `category` (one of 4). No nulls. **No date, no source, no sentiment, no ID column.**
- Review length: 41–125 chars (mean ~76). Short, single-sentence reviews.
- Categories (roughly balanced): Operational Issues 1,800 · Fraud and Scam 1,755 · Product Feedback 1,738 · Customer Service 1,707.
- **Only 320 unique review texts out of 7,000 (about 95% exact duplicates).** One text appears 295 times. No text appears under more than one category.
  - Unique texts per category: Product Feedback 183 · Customer Service 66 · Operational Issues 36 · Fraud and Scam 35.
- **Category is NOT sentiment.** Each category mixes positive and negative text. Examples:
  - Fraud and Scam: "I was scammed by a fraudulent seller..." (negative) but also "I was not a victim of fraud, the seller provided the genuine product" and "No signs of fraudulent activity" (positive, contains scam keywords). Keyword sentiment fails here; negation needs an LLM.
  - Customer Service: "outstanding, resolved my issue within minutes" (positive) vs "not helpful, issue remains unresolved" (negative).
  - Operational Issues: "Delivery was on time and packaging in perfect condition" (positive) vs "website kept crashing", "wrong items", "packaging damaged, items missing" (negative); some mixed ("delayed, but company kept me informed").
  - Product Feedback: mostly praise (innovative features, design, performance, value) with some defects/unmet-expectation complaints.
- Implications:
  1. Analyze the 320 unique texts once, then copy the results onto all 7,000 rows. Cheap and fast.
  2. Duplicates are a clear, demonstrable use of Adaption's deduplication recipe (section 3).
  3. Trends over time are impossible from the raw file: we add **clearly labeled simulated timestamps and sources** (section 6).

---

## 3. Adaption (the sponsor platform)

**What it is:** a platform that brings frontier-lab data-optimization and model-training techniques to everyday teams. Two products:
- **Adaptive Data** — turns raw data (CSV, JSON, JSONL, Parquet, PDF, DOCX, XLSX, etc.) into high-quality, training-ready datasets. Grades data quality before and after. Can also translate/localize into 242+ languages and "invent" datasets.
- **AutoScientist** — automates model training/fine-tuning on an adapted dataset; weights can be downloaded or pushed to Hugging Face/Kaggle. (Stretch goal only.)

**Hackathon access:** credits are pre-loaded on the account tied to the email the Adaption deck was sent to. Sign up at adaptionlabs.ai with that email. Missing credits → ask in Discord (discord.gg/adaption). Docs: docs.adaptionlabs.ai. Support: support@adaptionlabs.ai.

**Adaptive Data pipeline:** import → map columns → apply recipes → (optional) expand → brand controls → adapt + evaluate.

**Column roles:** `prompt`, `completion`, `context` (list), `image`, `chat`. A run needs at least a prompt or a completion; the missing one can be generated. A **universal prompt** applies one instruction to every row and requires at least one `context` column.

**Recipes** (booleans under `recipe_specification.recipes`): `deduplication`, `prompt_rephrase`, `reasoning_traces`.

**Brand controls:** `length` (minimal|concise|detailed|extensive; only applies when prompt_rephrase is on), `safety_categories` (annotates rows, does not remove them), `hallucination_mitigation` (web-search grounding; adds latency/credits), `blueprint` (a system prompt string).

**Other:** `job_specification.max_rows` (random sample for text; dedup happens after sampling, so output can be smaller), `estimate=True` returns `estimated_credits_consumed` and `estimatedMinutes` without starting a run, `language_expansion` (translate/localize).

### Two ways to run it in this project
- **Pipeline script (recommended):** a small Python script in `/pipeline` using the official SDK (`pip install adaption`). It does the heavy one-time run and writes `data/adapted_analysis.json`. SDK helpers (`upload_file`, `wait_for_completion`, `download`) make this the lowest-risk path.
- **Adaption web app (fallback):** adaptionlabs.ai/app lets you import, map columns, choose recipes and launch without code or an API key; then download the result. Use this if the SDK misbehaves.
- **From the Express app:** call Adaption's **REST API** with `fetch`/axios from `services/adaptionService.js` for read-only things (run status, evaluation scores) shown on the `/adaption` page. The docs list only a Python SDK and plain HTTP; no Node/TypeScript SDK is documented.

### Python SDK (pipeline)
```python
from adaption import Adaption
client = Adaption()                      # reads ADAPTION_API_KEY env var
ds = client.datasets.upload_file("unique_reviews.csv")   # .csv/.json/.jsonl/.parquet
dataset_id = ds.dataset_id

import time
while True:                               # wait for import
    st = client.datasets.get_status(dataset_id)
    if st.status == "failed": raise RuntimeError(st.error_data)
    if st.row_count is not None: break
    time.sleep(5)

column_mapping = {
    "universal_prompt": "<instruction text>",
    "context": ["review", "category"],
    # no completion column -> Adaption generates one   (VERIFY)
}
est = client.datasets.adapt(dataset_id, column_mapping=column_mapping,
        recipe_specification={"recipes": {"deduplication": True}},
        job_specification={"max_rows": 50}, estimate=True)
print(est.estimated_credits_consumed)

run = client.datasets.adapt(dataset_id, column_mapping=column_mapping,
        recipe_specification={"recipes": {"deduplication": True}})
status = client.datasets.wait_for_completion(dataset_id, timeout=3600)

ev = client.datasets.get_evaluation(dataset_id)   # ev.quality.score_before / score_after / improvement_percent
client.datasets.download(dataset_id, file_format="csv").write_to_file("adapted.csv")
```
Notes:
- `datasets.run` is a **deprecated alias** of `datasets.adapt`. Use `adapt`.
- Download formats: csv/json/jsonl/parquet. Parquet arrives as a gzipped tar of shards. Needs `adaption >= 0.9.0`.
- Statuses: launched → running → succeeded / failed. A failed run still downloads the rows processed so far.
- Queue time can be **hours** and may not be in the estimate. Never make the live demo depend on a fresh run completing.
- Evaluation returns before/after score (0–10), improvement percent, grade, percentile. Compact version: `client.datasets.get(dataset_id).evaluation_summary`.

### REST (for Express)
- Base: `https://api.prod.adaptionlabs.ai/api/v1`, header `Authorization: Bearer $ADAPTION_API_KEY`.
- `POST /datasets/{id}/adapt` · `GET /datasets/{id}/status` · `GET /datasets/{id}/evaluation` · `GET /datasets/{id}/download` · `POST /datasets/{id}/translate|localize|augment`.
- The API key stays on the server. Never commit it, never send it to the browser.

### UNKNOWNS — resolve in Phase 1 with a 50-row smoke test (`max_rows=50`, `estimate=True` first)
1. Does a universal-prompt run with **no completion column** work and return one completion per row?
2. What does the generated completion look like (plain text vs JSON)? Which column holds it in the downloaded file?
3. In universal-prompt mode, what does `deduplication` dedupe on, and how many rows come back?
4. Credit cost and real wall-clock time (queue + run) for 50 and for ~320 rows.
5. Exact evaluation field names (grade, percentile).

**Plan B (if Adaption cannot give reliable structured labels):** still use Adaption for deduplication, quality scoring before/after, and optionally translate/safety; produce the structured analysis with the runtime LLM (Gemini) using the same schema. Adaption's contribution must remain real, visible and explainable.

---

## 4. The product to build

**InsightFlow = feedback in → AI analysis → prioritized, explained decisions → tracked issues → shareable report.**

The differentiator for judges: a visible, honest **data pipeline powered by Adaption** and a **transparent priority score** that explains *why* an issue matters. Not just charts.

### How Adaption is used (the story to tell)
1. Raw feedback (7,000 rows, 95% duplicates) goes into Adaption.
2. **Adaptive Data deduplicates** and grades quality **before/after** (shown in-app as a "Data Quality" card).
3. A **universal prompt + Blueprint** makes Adaption generate a **structured analysis per unique review** (sentiment, topic, severity, summary, suggested action). Its output is the cleaned, labeled dataset the app runs on.
4. The adapted dataset is reused at runtime: it supplies **few-shot examples** (most similar reviews) so classification of newly submitted feedback uses the same taxonomy and style.
5. Optional: safety annotation, translate/localize for multilingual feedback, AutoScientist fine-tune of a small classifier (stretch only).

### Features mapped to requirements
| Req | Feature |
|---|---|
| 1 | Add-feedback form; CSV import (validate columns, preview, confirm); searchable, filterable, paginated table; "Load sample data" button (the provided CSV) |
| 2 | Per-review sentiment, topic (controlled taxonomy), severity, complaint flag; topic grouping; Adaption pipeline page |
| 3 | KPI cards (total, unique, % negative, avg sentiment, top issue), sentiment donut, issues bar chart, trend lines, category/sentiment/source/date filters |
| 4 | Priority ranking with score breakdown; recommendation text with evidence quotes and a "Why this matters" panel |
| 5 | "Track issue" with status (Open / Investigating / Resolved), owner, notes; report page with print-to-PDF and read-only share link |

---

## 5. Stack (decided)

- **Node.js + Express** server, **EJS** server-rendered pages (with `express-ejs-layouts` or partials), **MongoDB Atlas (free M0)** via **Mongoose**.
- **Frontend look:** Bootstrap 5 (CDN) for fast, responsive, polished UI; **Chart.js** (CDN) for charts; small vanilla JS files in `public/js` that `fetch` JSON endpoints for filters and charts.
- **Libraries:** `multer` (CSV upload), `csv-parse`, `dotenv`, `express-rate-limit` (optional), `helmet` (optional), `nanoid`/`crypto` for share tokens.
- **Adaption:** Python pipeline script (one-time heavy run) + REST calls from Express for status/evaluation (section 3).
- **Runtime AI for new feedback + recommendation text:** a free-tier LLM API called from Node (Gemini Flash is the default candidate; decision pending, see section 12), strict JSON schema prompt, results cached in MongoDB. Must degrade gracefully to cached/rule-based output if the API fails.
- **Deploy:** Render (free web service) or Railway for the Node app + Atlas for the DB. Note: Render free services sleep after inactivity; open the site shortly before the demo and before judging. In Atlas, allow network access from anywhere for the hackathon (free hosts have no fixed IP) and use a dedicated DB user with a strong password.
- **No auth** (single demo workspace). Not required by the problem statement; do not spend time on it.

---

## 6. Data design (MongoDB)

All dates and sources for the sample data are **simulated** (the CSV has none). Be transparent: store `isSimulated: true` and show a "demo timestamps" note in the UI and README. Imported/submitted rows with real values use real values.

### Collections
**feedbacks** (all 7,000 rows kept; analysis copied onto each row for fast filtering)
```
text, textHash (sha1 of normalized text), originalCategory,
source: 'Review'|'Survey'|'Support', createdAt, isSimulated: Boolean,
analysis: { sentiment, sentimentScore, topic, severity, isComplaint,
            issueSummary, suggestedAction, producedBy: 'adaption'|'llm-runtime'|'rules',
            adaptionRunId }
```
**analyses** (one per unique text; cache so duplicates and re-imports never re-call AI): `textHash (unique), ...same analysis fields`
**issues:** `topicKey, title, status ('open'|'investigating'|'resolved'), owner, notes, prioritySnapshot (object), createdAt, updatedAt`
**reports:** `token (unique, random), title, payload (snapshot object), createdAt`
**adaptionruns:** `runId, datasetId, status, rowsIn, rowsOut, scoreBefore, scoreAfter, improvementPercent, credits, notes, createdAt`

Indexes: `feedbacks.textHash`, `feedbacks.createdAt`, `feedbacks.analysis.topic`, `feedbacks.analysis.sentiment`, text index on `feedbacks.text`.

### Simulated fields
On seeding, assign seeded-random `createdAt` across the last 90 days and a `source`. Optionally weight so a couple of topics (e.g. delivery delays, fraud) rise in the last 3 weeks to give the trend charts a story. Use a fixed random seed so the data is reproducible.

### Topic taxonomy (controlled list so grouping is stable) — derived from the data
- Product: features/innovation · design · performance · value for money · defects · unmet expectations
- Customer service: responsiveness · helpfulness · knowledge · unresolved issue
- Fraud: non-delivery · extra payment demanded · counterfeit / not as advertised · double charge · false alarm (no fraud)
- Operations: delivery delay · damaged/missing packaging · wrong or missing items · website crashes/glitches · ordering process

Phase 1 finalizes ~14–18 topics after reading the 320 unique texts and stores them in `config/taxonomy.js` (the single source of truth: key, label, parent category). Each topic maps to one of the 4 original categories.

### Per-review analysis schema (what Adaption's completion and the runtime LLM must both return)
```json
{"sentiment":"positive|neutral|negative|mixed","sentimentScore":-1.0,
 "topic":"<taxonomy key>","severity":1,"isComplaint":true,
 "issueSummary":"<8-12 words>","suggestedAction":"<one sentence>"}
```
Draft Adaption universal prompt: *"You are a customer-feedback analyst. Read the review and its original category. Return ONLY valid JSON with keys sentiment, sentimentScore (-1 to 1), topic (one of: <taxonomy keys>), severity (1-5, 5 = fraud/financial harm or safety), isComplaint, issueSummary, suggestedAction. Handle negation correctly (e.g. 'not a victim of fraud' is positive)."* Pair with a Blueprint enforcing JSON-only output. Parse defensively; validate; on failure retry once, then fall back.

### Priority score (explainable, shown as a breakdown)
For each topic over a selected window:
`priority = 100 × (0.35·volume + 0.30·negativity + 0.20·severity + 0.15·trend)`
- volume = topic's share of all complaints (min-max normalized)
- negativity = share of the topic's mentions that are negative or mixed
- severity = mean severity / 5
- trend = growth of complaints in the last 14 days vs the previous 14 days (clamped 0–1)

The UI shows each factor as a bar plus a sentence ("Ranked #1: 18% of complaints, 94% negative, severity 4.8/5, up 40% in 14 days") and 2–3 example quotes. Show both "total mentions" and "unique phrasings" because duplicates inflate volume.

---

## 7. Architecture contract (all phases and all AIs must follow this)

### Folder structure
```
insightflow/
  server.js                 # app entry (or app.js + server.js)
  package.json
  .env.example              # real .env is gitignored
  config/db.js              # mongoose connect
  config/taxonomy.js        # topics (single source of truth)
  models/                   # Feedback.js Analysis.js Issue.js Report.js AdaptionRun.js
  routes/                   # pages.js feedback.js import.js insights.js issues.js reports.js adaption.js api.js
  services/                 # analysisService.js priorityService.js recommendationService.js
                            # adaptionService.js importService.js statsService.js
  views/                    # layout.ejs, partials/ (navbar, footer, filters, flash), pages/ (dashboard, feedback, import,
                            # insights, issues, reports, report-public, adaption, home)
  public/css/ public/js/    # app.css, charts.js, filters.js, feedback.js
  scripts/seed.js           # loads data/ into MongoDB
  pipeline/                 # adaption_pipeline.py, requirements.txt, README.md
  data/                     # raw_feedback.csv, unique_reviews.csv, adapted_analysis.json
  README.md
```

### Environment variables (`.env.example`)
`PORT`, `MONGODB_URI`, `ADAPTION_API_KEY`, `ADAPTION_DATASET_ID` (after the run), `LLM_API_KEY`, `LLM_MODEL`, `BASE_URL` (for share links)

### Routes
Pages (EJS): `GET /` · `GET /dashboard` · `GET /feedback` · `POST /feedback` · `GET /import` · `POST /import/preview` · `POST /import/confirm` · `POST /import/sample` (load the provided sample) · `GET /insights` · `GET /issues` · `POST /issues` · `POST /issues/:id` (status/notes/owner) · `GET /reports` · `POST /reports` · `GET /r/:token` · `GET /adaption`
JSON: `GET /api/stats` · `GET /api/trends` · `GET /api/topics` · `GET /api/priorities` · `GET /api/feedback` · `POST /api/analyze` · `GET /api/adaption/status`

### Shared filter query parameters (same everywhere)
`category`, `sentiment`, `topic`, `source`, `from`, `to`, `q` (search), `page`, `limit`

### Conventions
- CommonJS (`require`), `async/await`, Mongoose, no TypeScript, no front-end framework. Small files, comments that explain *why*.
- Use `<%= %>` (escaped) in EJS for any user text. Never `<%- %>` on user-supplied content.
- Business logic lives in `services/`, not in route files. Routes stay thin.
- Aggregations use MongoDB aggregation pipelines in `statsService.js`.
- Every AI call is cached in `analyses` and wrapped in try/catch with a fallback. Pages must still render when the AI or Adaption is unreachable.
- Secrets only in `.env`. Validate and size-limit uploads (CSV max a few MB, row cap).
- Every page needs loading, empty and error states, and must work on a phone-width screen.

---

## 8. Phases (each is a self-contained hand-off unit)

Estimated hours total roughly 40–48; the rest of the 48h is buffer. Dependencies: P0 → P1, P2 → P3 → P4/P5 → P6 → P7 → P8 → P9. Never cut: deployment, sample data, dashboard, priorities with "why", report export, Adaption page.

### Phase 0 — Setup and accounts (1–2h)
- Tasks: GitHub repo; `npm init`, install deps; Express + EJS "hello" page with the layout; MongoDB Atlas cluster + user; `.env`/`.env.example`/`.gitignore`; **deploy the hello app to Render now** (proves the pipeline end to end); Adaption account, credits check, API key; LLM API key.
- Done when: live URL shows the hello page, connected to Atlas, secrets only in env vars.
- Hand-off: repo URL, live URL, folder skeleton from section 7.

### Phase 1 — Adaption smoke test, pipeline and taxonomy (4–6h) — highest uncertainty, do early
- Tasks: create `unique_reviews.csv` (320 unique rows with `review`, `category`); read all 320 and finalize `config/taxonomy.js`; Python pipeline: upload, **50-row estimate and run**, record answers to the section-3 unknowns; then the full run on the unique rows (dedup + universal prompt + Blueprint); fetch evaluation (before/after); download to `data/adapted_analysis.json`; save run info for the `adaptionruns` collection. Apply Plan B if Adaption's output is unusable.
- Done when: `data/adapted_analysis.json` has one valid analysis per unique text (schema from section 6), the unknowns are answered in section 13, and quality before/after plus credits/time are recorded.
- Hand-off: the JSON file, taxonomy file, run IDs, scores, notes on Adaption's behaviour.

### Phase 2 — Data layer and seeding (3–4h)
- Tasks: Mongoose models; `scripts/seed.js`: read the raw 7,000 rows, normalize and hash text, join with `adapted_analysis.json`, assign seeded simulated `createdAt`/`source`, insert `feedbacks` (with embedded analysis), `analyses`, `adaptionruns`; create indexes; a verification script printing counts per category/sentiment/topic.
- Done when: counts match (7,000 feedbacks, 320 analyses), no feedback lacks analysis, simulated flag set, verification output pasted in section 13.

### Phase 3 — App shell and feedback management (5–6h) — Requirement 1
- Tasks: layout, navbar, Bootstrap theme, home page with "Load sample data"; `/feedback` table with search, filters, sort, pagination; add-feedback form (calls analysis service stub for now); `/import` CSV upload with preview, column validation and confirm; flash messages; responsive pass.
- Done when: all of Requirement 1 works on the deployed URL.

### Phase 4 — Runtime AI analysis service (3–4h) — Requirement 2
- Tasks: `analysisService.js`: check `analyses` cache by `textHash`; else pick 3–5 most similar adapted examples (simple TF-IDF/keyword overlap is enough) as few-shot, call the LLM with the schema prompt, validate, cache; fallback to simple rules if the API fails; wire into add-feedback and CSV import (batch with concurrency limit); show the producer badge ("Adaption-labelled" vs "AI-labelled").
- Done when: new feedback gets sentiment/topic/severity within seconds, including negation cases like "I was not a victim of fraud".

### Phase 5 — Dashboard (5–6h) — Requirement 3
- Tasks: `statsService.js` aggregations; `/api/stats`, `/api/trends`, `/api/topics`; dashboard page with KPI cards, sentiment donut, top issues bar, trend lines (daily/weekly), shared filter bar (category, sentiment, topic, source, date range) that refreshes charts without a full reload; "demo timestamps" note.
- Done when: filters change every chart and KPI consistently; works on mobile width.

### Phase 6 — Priority engine and recommendations (4–5h) — Requirement 4
- Tasks: `priorityService.js` implementing the score in section 6 with per-factor breakdown; `/insights` page: ranked issue cards, breakdown bars, evidence quotes, "Why this matters"; `recommendationService.js`: LLM generates a short recommendation per top issue from computed stats and quotes (grounded: only use supplied numbers), cached; template-based fallback.
- Done when: top 5 issues show score, reasons, quotes and an actionable recommendation, even with the LLM offline.

### Phase 7 — Issue tracking and reports (4–5h) — Requirement 5
- Tasks: "Track issue" button on insight cards → `issues` (snapshot of the priority at tracking time); `/issues` board/table with status, owner, notes; `/reports`: build a report snapshot (title, date range, KPIs, top issues, recommendations, tracked issues) → saved to `reports` with random token; `/r/:token` read-only public page; print stylesheet so "Print / Save as PDF" looks clean.
- Done when: issue status changes persist; a shared link opens without any login and prints neatly.

### Phase 8 — Adaption page and polish (3–4h)
- Tasks: `/adaption` page: pipeline diagram (raw → dedup → analysis → app), rows in/out, quality before → after, run ID, status (live via REST with cached fallback), how the adapted data is used at runtime; UI polish (consistent spacing, empty/error states, favicon, page titles, accessibility basics).
- Done when: a judge can understand the Adaption integration from this page alone.

### Phase 9 — Deploy hardening, docs, demo, submission (4–5h)
- Tasks: production seed on Atlas; env check on Render; warm-up before demo; test on phone; README (setup, architecture, Adaption section, simulated-data disclosure, screenshots); record the 3–4 min demo; write the Adaption explanation (section 11); final checklist against the problem statement; submit early.
- Done when: live URL, repo, demo and write-up are submitted with time to spare.

### Suggested allocation between AIs
Do the judgment-heavy phases while a strong assistant is available: **P1 (Adaption), P2 (data design), P6 (priority/recommendations)**. Boilerplate-heavy phases (**P3, P5, P8**) are easy for any AI if the contracts in section 7 are followed. Whoever works on a phase must receive this file plus the relevant existing files.

---

## 9. Hand-off protocol (so switching AIs causes no confusion)

After every phase (or when stopping mid-phase):
1. `git add -A && git commit -m "Phase N: <summary>"` and push.
2. Update section 13: tick the phase, record decisions, **contract changes**, known issues, and the exact next step.
3. Ask the AI for the **Phase report** and paste it into section 13:
   - What was built (files created/changed, one line each)
   - How to run and verify it (commands, URLs, expected output)
   - Contract changes (routes, schema, env vars, folder names)
   - Known issues / TODOs
   - Exact next step
4. When switching AI: send the first-message prompt from MASTER_PROMPT.md, attach this file, and paste `git ls-files` plus any files the next phase will touch.
5. If cut off mid-phase: use the "Resume" prompt in MASTER_PROMPT.md and paste the files you were editing.

---

## 10. Risks and mitigations
- **Adaption queue/credit limits:** estimate first, use `max_rows`, run in Phase 1, cache outputs, never block the demo on a live run.
- **Adaption output format surprises:** smoke test; defensive JSON parsing; Plan B (section 3).
- **No dates in dataset:** simulated and labeled (section 6).
- **Heavy duplicates skew volume:** show total mentions and unique phrasings.
- **LLM API outages/rate limits:** cache every AI output; fallbacks everywhere.
- **Render free tier sleeps:** warm up before demo; consider a cheap uptime ping.
- **Time sink on polish:** deploy at Phase 0 and redeploy after every phase.
- **Secrets:** keys only in server env vars; never in the repo, never in client JS.
- **Multiple AIs drifting:** the section 7 contract and the section 13 log are the guardrails.

---

## 11. Demo script (3–4 min) and Adaption write-up outline
**Demo:** 1) the problem in one sentence + load sample data (7,000 rows) · 2) Adaption page: duplicates removed, quality before → after, how the structured analysis was generated · 3) dashboard: sentiment, top issues, trend, filter by category · 4) insights: #1 priority with score breakdown, quotes, recommendation · 5) track the issue, change its status · 6) submit a new feedback live → instant analysis (try a negation example) · 7) export/share the report.

**Adaption write-up:** the problem it solved (95% duplicates, no labels) · features used (deduplication, universal prompt + Blueprint, evaluation, optional translate/safety) · where it sits in the workflow · measurable result (rows 7,000 → 320 unique, quality score before/after, credits/time) · how adapted data powers runtime classification · what comes next (AutoScientist-trained classifier).

---

## 12. Open decisions (answer and record in section 13)
- ~~Stack~~ → decided: MongoDB + Express + Node + EJS.
- Which free LLM API for runtime analysis (Gemini Flash default; alternatives: Groq or similar)?
- Are Adaption credits visible in the account yet?
- When did the 48h clock start / what is the deadline? (fill in the schedule with real times)
- Hosting choice: Render (default) or Railway?

---

## 13. PROGRESS LOG (update after every phase)

Clock started: ______  Deadline: ______

- [x] Read problem statement, dataset, Adaption docs and deck; dataset profiled (section 2)
- [x] Stack decided: MongoDB + Express + Node + EJS
- [ ] Phase 0 — Setup and accounts
- [ ] Phase 1 — Adaption smoke test, pipeline, taxonomy
- [ ] Phase 2 — Data layer and seeding
- [ ] Phase 3 — App shell and feedback management
- [ ] Phase 4 — Runtime AI analysis service
- [ ] Phase 5 — Dashboard
- [ ] Phase 6 — Priority engine and recommendations
- [ ] Phase 7 — Issue tracking and reports
- [ ] Phase 8 — Adaption page and polish
- [ ] Phase 9 — Deploy hardening, docs, demo, submission

Links: repo ______ · live URL ______ · Adaption dataset ID ______ · run ID ______

Current phase: Phase 0 (not started)

Answers to Adaption unknowns (Phase 1): (none yet)

Contract changes: (none yet)

Decisions made: (none yet)

Known issues: (none yet)

Latest Phase report: (none yet)
