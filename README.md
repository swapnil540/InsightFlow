# InsightFlow

InsightFlow is a customer-feedback analysis app being built for Build Battle 2026. The goal is to help teams turn customer reviews into useful themes, priorities, and decisions.

## Current status

The project currently contains the initial Express and EJS app shell:

- A responsive landing page styled with Bootstrap 5.
- A MongoDB connection attempt that reports errors but lets the web server continue.
- A health endpoint that reports whether Mongoose is connected.
- The hackathon feedback CSV in `data/raw_feedback.csv`.

The analysis, dashboard, issue tracking, and reporting features are planned work and are not implemented yet. MongoDB Atlas and Render are not configured by this repository; deployment and database setup require your own accounts and environment variables.

## Run locally

Requirements: Node.js 18 or newer and npm.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`. Set `PORT` to `3000` and add your MongoDB Atlas connection URI as `MONGODB_URI`. Keep `.env` private; it is excluded from Git.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`. Check the app and database status at `http://localhost:3000/health`.

The health endpoint returns JSON with `ok`, `db` (`connected` or `disconnected`), and an ISO timestamp. The app can serve pages when MongoDB is not reachable; the health endpoint will show `disconnected`.

For a production-style local start, use `npm start`.

## Project structure

```text
config/          Database connection setup
data/            Source feedback dataset
docs/            Project documentation
models/          Mongoose models (future work)
pipeline/        Data-processing pipeline (future work)
public/css/      App stylesheets
public/js/       Browser-side JavaScript (future work)
routes/          Express route handlers
scripts/         Local utility scripts (future work)
services/        Business logic (future work)
views/           EJS layout, partials, and pages
server.js        Express application entry point
```

## Tech stack

- Node.js and Express
- EJS with `express-ejs-layouts`
- MongoDB Atlas with Mongoose
- Bootstrap 5 via CDN

## Dataset

`data/raw_feedback.csv` contains the customer-feedback dataset supplied for the hackathon. Its source records do not include dates; any dates added later for trend demonstrations should be identified as simulated.

## Environment variables

See `.env.example` for the supported variables: `PORT`, `MONGODB_URI`, `ADAPTION_API_KEY`, `ADAPTION_DATASET_ID`, `LLM_API_KEY`, `LLM_MODEL`, and `BASE_URL`. Add secrets only to `.env` locally or your hosting provider's secret settings—never commit them.

## Roadmap

The planned work includes testing the Adaption data workflow, preparing the data layer, adding feedback management and analysis, building a dashboard with explainable issue priorities, and adding reports and deployment hardening. The implementation should remain understandable and demonstrable at each step.
