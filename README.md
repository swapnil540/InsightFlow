# InsightFlow

> Intelligent customer-feedback analysis and decision platform built for **Build Battle 2026**.

**Live URL:** [https://insightflow-ogl7.onrender.com/](https://insightflow-ogl7.onrender.com/)  
**Health Endpoint:** [https://insightflow-ogl7.onrender.com/health](https://insightflow-ogl7.onrender.com/health)

---

## Overview

InsightFlow helps businesses transform noisy, unorganized customer feedback into clear priorities, actionable recommendations, and shareable executive reports. It bridges the gap between raw unstructured reviews and engineering/product action by leveraging **Adaption Adaptive Data** to classify sentiments, assign controlled taxonomy topics, calculate transparent priority scores, track open issues, and publish snapshot reports.

---

## Key Features

1. **Feedback Ingestion & Management (`/feedback`, `/feedback/new`)**
   - Search by keyword and filter by category, sentiment, topic, source channel, complaint status, and date range.
   - Grouped and detailed feedback views with pagination.
   - Manual feedback submission with instant similarity-based analysis.

2. **CSV Import Pipeline (`/import`)**
   - Ingest customer feedback in bulk with automatic preview, column mapping, header alias detection, and duplicate handling.
   - Validation checks with a 10,000-row cap and downloadable CSV template (`/import/template.csv`).

3. **Executive Dashboard (`/dashboard`)**
   - High-level KPIs: Total Mentions, Unique Phrasings, Complaint Rate, and Average Sentiment Score.
   - Interactive breakdown charts for sentiment distribution and taxonomy topics.
   - 90-day time-series volume trends and rising issues detection.

4. **Explainable Priorities & Recommendations (`/insights`)**
   - Transparent 4-factor scoring algorithm:
     $$\text{Score} = 100 \times (0.35 \times \text{Volume} + 0.30 \times \text{Negativity} + 0.20 \times \text{Severity} + 0.15 \times \text{Trend})$$
   - Specific, actionable recommendations and grounded evidence quotes for each topic.
   - One-click workflow to convert priority findings into tracked issues.

5. **Issue Tracking (`/issues`)**
   - Lifecycle management across `open`, `investigating`, and `resolved` statuses.
   - Owner assignment, priority snapshots, and internal progress notes.

6. **Executive Reports & Public Sharing (`/reports`, `/r/:token`)**
   - Generate point-in-time snapshot reports with automated executive summary bullets.
   - Secure, read-only tokenized URLs (`/r/:token`) designed for stakeholder sharing.
   - Clean, distraction-free print-to-PDF stylesheet.

7. **Adaption Architecture & Governance (`/adaption`)**
   - Interactive view of the data pipeline, deduplication efficiency, and run parameters.
   - Real-time run results from MongoDB Atlas: scores before/after, letter grades, percentiles, and sample sizes.
   - Transparent documentation of iterations and evaluation findings.

---

## How Adaption is Used

InsightFlow relies on **Adaption Adaptive Data** as a core pillar of its data architecture:

- **The Problem:** The raw hackathon dataset (`data/raw_feedback.csv`) contained 7,000 rows with 4 broad categories, but 95% of rows were exact duplicates (only 320 unique texts). The dataset lacked sentiment scores, granular topics, severity ratings, and complaint flags. Furthermore, category names were not sentiment-indicative (e.g., *"I was not a victim of fraud"* sat in "Fraud and Scam").
- **Adaptation Workflow:**
  1. **Deduplication:** Text was normalized and hashed via SHA-1, distilling 7,000 rows into 320 unique reviews to eliminate redundant token consumption.
  2. **Adaptive Data Run:** Configured a universal prompt with a strict JSON blueprint, 16-topic taxonomy, deduplication on, and prompt rephrasing disabled (to preserve verbatim user feedback).
  3. **Quality Iteration:** An initial full run achieved 8–12 word issue summaries in only 34% of rows. Tightening the universal prompt and blueprint instructions raised summary compliance to **100% (320/320)**. All 8 false-alarm negation cases were correctly classified as positive non-complaints.
- **Evaluation Results:**
  - **Overall Score:** Improved from **5.0 to 9.5** (Grade **C** to Grade **A**, **+90.0%** improvement, 57.7th percentile).
  - **Completion vs. Message Quality:** As recorded in the evaluation run notes, the source data had no completions, so quality gains derived primarily from Adaption generating completions (0.97 &rarr; 9.87) while message quality remained stable (9.16 &rarr; 9.11).
- **Runtime Inference via Transfer Learning:**
  - `services/analysisService.js` and `services/similarityClassifier.js` index the 320 Adaption-labelled analyses.
  - When new feedback arrives via manual submission or CSV upload, a k-NN similarity classifier compares token and bigram overlap with negation sensitivity to transfer high-confidence Adaption labels, falling back gracefully to deterministic rule heuristics when needed.

---

## Simulated Data Disclosure

The source dataset (`data/raw_feedback.csv`) contains only two columns: `review` and `category`. It includes no dates or channel origins:

- All timestamp data (covering a 90-day window) and source tags (`Review`, `Survey`, `Support`) were deterministically generated using a seeded PRNG (`0x1f10f10`) to illustrate realistic operational trends.
- In accordance with hackathon guidelines, every simulated database entry is explicitly flagged with `isSimulated: true`.
- Dates and sources are simulated for demonstration purposes.

---

## Tech Stack

- **Runtime & Server:** Node.js 18+, Express 5, `express-ejs-layouts`
- **Database:** MongoDB Atlas via Mongoose 9
- **Frontend:** Bootstrap 5.3, Bootstrap Icons, Chart.js, Vanilla JavaScript
- **Testing:** Node.js native test runner (`node --test`)
- **Pipeline:** Python 3 (`pipeline/`, Adaption SDK 0.14.0, pandas)

---

## Local Setup

### 1. Prerequisites

- Node.js 18 or newer
- npm
- (Optional for offline pipeline scripts) Python 3.10+ in `.venv`

### 2. Installation

```bash
git clone https://github.com/swapnil540/InsightFlow.git
cd InsightFlow
npm install
```

### 3. Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Configure the following variables in `.env`:

| Variable | Description |
|---|---|
| `PORT` | Local web server port (default: `3000`) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `ADAPTION_API_KEY` | Adaption platform API key (for pipeline scripts) |
| `ADAPTION_DATASET_ID` | Adaption dataset identifier (for pipeline scripts) |
| `LLM_API_KEY` | Optional LLM API key |
| `LLM_MODEL` | Optional LLM model identifier |
| `BASE_URL` | Application base URL (e.g. `http://localhost:3000`) |

> **Note:** Never commit `.env` or sensitive credentials to Git.

### 4. Database Seeding

InsightFlow includes deterministic seed and verification commands:

```bash
# Dry run verification without MongoDB connection
npm run seed:dry -- --anchor 2026-10-12T08:00:00Z

# Write sample feedback, analyses, and Adaption runs to MongoDB
npm run seed:write -- --anchor 2026-10-12T08:00:00Z

# Verify collection integrity, taxonomy compliance, and date windows
npm run seed:verify -- --anchor 2026-10-12T08:00:00Z
```

### 5. Running the Test Suite

Run the 47 automated unit and integration tests:

```bash
npm test
```

### 6. Starting the Application

```bash
# Production start
npm start

# Development mode with nodemon
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Verify database health at [http://localhost:3000/health](http://localhost:3000/health).

---

## Application Routes

### Web Pages

| Route | Description |
|---|---|
| `GET /` | Landing page with platform overview and quick actions |
| `GET /health` | Healthcheck returning database state and collection counts |
| `GET /feedback` | Searchable, filterable feedback browser with pagination |
| `GET /feedback/new` | Manual feedback entry form |
| `POST /feedback` | Ingest single feedback entry with real-time classification |
| `GET /import` | CSV batch upload and validation interface |
| `GET /import/template.csv` | Download sample CSV template |
| `POST /import/preview` | Upload and preview CSV rows before persistence |
| `POST /import/confirm` | Confirm batch import |
| `POST /import/sample` | Reload/reset deterministic 7,000-row sample dataset |
| `GET /dashboard` | Executive analytics dashboard with KPIs and Chart.js graphs |
| `GET /insights` | Explainable priority rankings and actionable recommendations |
| `POST /issues/track` | Convert insight into a tracked issue |
| `GET /issues` | Issue tracker with status filtering (`open`, `investigating`, `resolved`) |
| `POST /issues/:id` | Update issue status, owner, or notes |
| `GET /reports` | Saved executive reports listing and generator |
| `POST /reports` | Generate snapshot executive report |
| `GET /r/:token` | Public, tokenized read-only report view (print-to-PDF ready) |
| `GET /adaption` | Adaption pipeline architecture, run metrics, and evaluation write-up |

### REST API

| Endpoint | Method | Description |
|---|---|---|
| `/api/analyze` | `POST` | Real-time text analysis via similarity classifier (rate-limited) |
| `/api/stats` | `GET` | Aggregated KPI stats matching filter parameters |
| `/api/topics` | `GET` | Topic distributions, complaint counts, and sentiment metrics |
| `/api/trends` | `GET` | Time-series daily/weekly sentiment volume trends |
| `/api/priorities` | `GET` | 4-factor priority score calculation for all taxonomy topics |

---

## License

ISC License. Built for Build Battle 2026.
