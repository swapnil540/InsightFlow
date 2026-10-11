You are my coding assistant inside VS Code. I'm competing solo in a 48-hour hackathon (Build Battle 2026) and building "InsightFlow", a customer-feedback analysis web app (Node.js + Express + EJS + MongoDB). Today's job is PHASE 0: set up the repository and a minimal Express + EJS app, connect it to MongoDB Atlas, and DEPLOY it to Render, so we have a live URL from the very start. No real features yet.

CONTEXT (read first)
My project folder is open in VS Code. Its root may contain HACKATHON_CONTEXT.md (the single source of truth: problem, architecture contract in section 7, phase plan in section 8, hand-off protocol in section 9, progress log in section 13), MASTER_PROMPT.md, and the dataset CSV. Read HACKATHON_CONTEXT.md completely before doing anything, especially sections 5, 7 and 8. Follow its contracts exactly. If you can't open files in the workspace, tell me and I'll paste them.

WORKING RULES
- One step at a time. After each step: show me what to run or what you changed, tell me how to verify it, then STOP and wait for my "ok" before the next step.
- Explain every file you create in about 5 plain lines. I must be able to explain all of my code to the judges.
- Keep code simple, readable and commented. CommonJS (`require`), async/await, no TypeScript, no front-end framework.
- If you can't run terminal commands yourself, give me the exact commands and wait for me to paste the output. Ask which OS and shell I use (Windows PowerShell, macOS or Linux) before giving commands.
- Some steps are manual, on websites (MongoDB Atlas, Render, API key pages). For those, give me short numbered click-by-click instructions and wait for me to tell you when I'm done. Don't pretend you did them.
- SECRETS: never ask me to paste a password, connection string or API key into this chat, never print one, never commit .env. Secrets live only in a gitignored .env file locally and in Render's environment variable settings online. Before every commit run `git status` and check that no secret is staged.
- Don't guess about third-party services. If you're unsure how a dashboard or setting looks today, say so and tell me what to look for.

STEPS
0. REPO CHECK. Run `git status` and `git remote -v` and look at the folders. If my GitHub repo is already connected and the project skeleton (docs/, data/, .gitignore, .env.example) exists, say so and go to step 1. If not, do the minimal repo setup first: check that git, node (`node -v`, 18 or newer) and python are installed; `git init` on branch `main`; create the folder skeleton from section 7 of the context file with `.gitkeep` in empty folders (config, models, routes, services, views/partials, views/pages, public/css, public/js, scripts, pipeline, data, docs); move HACKATHON_CONTEXT.md and MASTER_PROMPT.md into docs/ and the dataset CSV into data/raw_feedback.csv; create `.gitignore` (node_modules, .env, .venv, __pycache__, pipeline/out/, .DS_Store, *.log) and `.env.example` listing PORT, MONGODB_URI, ADAPTION_API_KEY, ADAPTION_DATASET_ID, LLM_API_KEY, LLM_MODEL, BASE_URL (all empty); make the first commit; then create the private GitHub repo `insightflow`. If the GitHub CLI is installed and authenticated (`gh auth status`) use `gh repo create insightflow --private --source=. --push`; otherwise tell me to create an empty private repo on github.com (no README, no .gitignore) and give me `git remote add origin <url>` and `git push -u origin main`. Confirm the push worked.

1. NODE PROJECT. In the repo root run `npm init -y`, then install: express, ejs, express-ejs-layouts, mongoose, dotenv; and as a dev dependency: nodemon. In package.json set `"main": "server.js"`, scripts `"start": "node server.js"` and `"dev": "nodemon server.js"`, and `"engines": {"node": ">=18"}`. Commit.

2. EXPRESS + EJS APP. Create:
   - config/db.js: a function that connects Mongoose to process.env.MONGODB_URI and logs success or the error. It must not crash the whole server if the database is unreachable (log the error and keep serving), so we can see the problem on the health page.
   - server.js: loads dotenv, creates the Express app, sets EJS as the view engine with express-ejs-layouts, serves /public as static files, mounts the routes below, listens on process.env.PORT or 3000.
   - views/layout.ejs: HTML5 page with viewport meta tag, Bootstrap 5 from the CDN, the navbar and footer partials, and `<%- body %>`. Page title comes from a variable.
   - views/partials/navbar.ejs and footer.ejs: navbar with the brand "InsightFlow" and placeholder links (Dashboard, Feedback, Insights, Issues, Reports, Adaption) that can point to "#" for now. Responsive (collapses on phones).
   - views/pages/home.ejs: a clean hero section ("InsightFlow, turn customer feedback into decisions") with a short description and a disabled "Load sample data" button labelled "coming in Phase 3".
   - routes/pages.js: `GET /` renders home; `GET /health` returns JSON `{ ok: true, db: "connected" | "disconnected", time: <ISO string> }` using mongoose.connection.readyState. (/health is a small addition to the route contract; remind me to record it in section 13.)
   - public/css/app.css: a few custom styles (keep it small) and link it from the layout.
   Use `<%= %>` (escaped) for any variable output in EJS. Commit.

3. MONGODB ATLAS (manual). Guide me: create a free M0 cluster; create a database user with a strong password (tell me to avoid special characters, or URL-encode them in the connection string); under Network Access allow access from anywhere (0.0.0.0/0) because free hosting has no fixed IP (explain the trade-off in one sentence and that the strong password matters); copy the connection string and add the database name `insightflow` to it. I put it into a local `.env` as MONGODB_URI myself (not in this chat). Then add `PORT=3000` to my .env.

4. RUN LOCALLY. `npm run dev`, open http://localhost:3000 (home page renders, navbar works on a narrow window) and http://localhost:3000/health (should show db: "connected"). If it says "disconnected", help me debug: check the URI, the user, the password and the Atlas network access. Commit and push.

5. DEPLOY TO RENDER (manual). Guide me: create a Render account and connect GitHub; New Web Service from the `insightflow` repo; free instance type; region closest to me; build command `npm install`; start command `npm start`; environment variables: MONGODB_URI (paste there, not here) and NODE_ENV=production; auto-deploy on push to main. After the first deploy, open https://<my-service>.onrender.com/health and check db: "connected". Then set BASE_URL to the live URL in Render's environment variables and in my local .env.example comment. Remind me that Render's free tier sleeps when idle and the first request after a pause is slow, so I should open the site shortly before any demo or judging.

6. DEPLOY PIPELINE TEST. Make a tiny visible change on the home page (for example add a version line), commit, push, and confirm Render redeploys and the live site shows it. Tell me how to read Render's logs if a deploy fails.

7. ACCOUNT CHECKLIST (manual, no code). Remind me to (a) sign up at adaptionlabs.ai with the same email the hackathon deck was sent to and check that my credits show up (if missing, ask in the Adaption Discord); I'll create the API key in Phase 1. (b) Optional now: get a free API key for the runtime AI model (Gemini via Google AI Studio is the default choice; I'll tell you if I choose another) and check the current free quota in its dashboard before we depend on it.

8. OPTIONAL: LLM KEY TEST. Only if I now have the key in my .env as LLM_API_KEY, with LLM_MODEL set to a model name I confirmed in the provider's current docs (do NOT guess model names; look at the provider's docs or ask me): create scripts/test-llm.js, a small Node script (built-in fetch) that sends one short prompt, asks for a tiny JSON answer, and prints the parsed result. It proves the key works. Don't print the key. Commit.

9. UPDATE THE DOCS AND HAND OFF. In docs/HACKATHON_CONTEXT.md section 13: tick Phase 0; fill in the clock start time if I tell you, the repo URL, the live URL, the hosting choice (Render, region), which env vars are set where (names only, never values), the contract addition (GET /health), decisions and known issues; set "Current phase: Phase 1". Commit "Phase 0 complete" and push. Finally give me the PHASE REPORT in this format: what was built (files, one line each); how to run and verify; contract changes; decisions; known issues; exact next step.

DEFINITION OF DONE
- Private GitHub repo with the skeleton and docs, clean commits, no secrets in history.
- Live Render URL where `/` shows the home page and `/health` shows db "connected".
- Local run works with `npm run dev`; pushing to main redeploys automatically.
- Section 13 of the context file is updated with links and decisions, and the next phase is set to Phase 1.

Start now: read HACKATHON_CONTEXT.md, then reply with (1) a 5-line summary of what we're doing today, (2) the questions you need answered (OS and shell, whether gh is installed, whether the repo already exists), and (3) step 0.
