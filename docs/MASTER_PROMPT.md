# MASTER PROMPTS — copy the block you need

How to use: start a new chat with the other AI, **attach HACKATHON_CONTEXT.md** (or paste its full text), then paste Prompt 1. Later, use Prompts 2–4 as needed.

---

## Prompt 1 — First message to a new AI (paste this with the context file)

```
I'm competing solo in a 48-hour hackathon (Build Battle 2026, Frontend Arena) and I'm building "InsightFlow", a customer feedback analysis platform. I'm a computer engineering student; I know MongoDB, Express, Node.js and EJS, so the project uses that stack.

I've attached HACKATHON_CONTEXT.md. It contains the full problem statement, dataset analysis, Adaption (sponsor platform) notes, the decided stack, the architecture contract (folders, collections, routes, env vars, JSON schema), the phase plan (Phases 0-9), the hand-off protocol and a progress log. Treat it as the single source of truth. Several different AIs are working on different phases of this project, so follow its contracts exactly.

Your job: act as my technical lead and builder for this project. Do this now:

1. Read the whole file. Reply with a summary of the project in at most 8 lines, to prove you understood it (problem, stack, how Adaption is used, what the dataset looks like).
2. Check section 13 (progress log) and tell me which phase is current. If nothing is ticked, the current phase is Phase 0.
3. Tell me what I need to have ready for this phase (accounts, keys, files, code to paste). Ask me only questions that block you; do not ask about things the file already answers.
4. Then give me the plan for the current phase as numbered steps, and start with step 1.

Working rules:
- One phase at a time, and within a phase one small step at a time. After each step, tell me how to verify it, then wait for me to confirm before moving on.
- Explain what each piece of code does and why, in simple language. I must be able to explain all of it to the judges.
- Give complete files with their paths, exact terminal commands, and what I should see when it works.
- Do not change the contracts in section 7 (folders, collections, routes, env vars, schema, conventions) without telling me exactly what changes and why, so I can record it under "Contract changes".
- You can't see my repo. If you need existing code, ask me to paste specific files or the output of `git ls-files`. Never guess what's in a file.
- Do not invent facts about Adaption's API. Anything marked VERIFY must be tested with a small run first. If something fails, show me how to debug it rather than silently changing the plan.
- Keep it simple. A working, deployed app beats an ambitious broken one. Warn me if I'm about to spend time on something that isn't needed for the requirements.
- Always keep a fallback so the demo can't break (cached AI results, rule-based fallback).
- When we finish a phase, give me the "Phase report" described in section 9 so I can paste it into the progress log before switching assistants.

Start now.
```

---

## Prompt 2 — Start or continue a specific phase (use when the AI already knows the project)

```
Continue with Phase [N] from HACKATHON_CONTEXT.md.

Current state: [one or two lines: what's done, live URL, anything unusual]
Relevant files I'm pasting below: [list them, then paste them]

Follow section 7 contracts. Give me the numbered steps for this phase, then begin step 1. After each step tell me how to verify it. When the phase's "Done when" condition is met, give me the Phase report.
```

---

## Prompt 3 — Resume after being cut off mid-phase (new AI or new chat)

```
I was in the middle of Phase [N] with another assistant and ran out of limit. HACKATHON_CONTEXT.md is attached (single source of truth; read it first).

Where I stopped: [what was the last step completed, and what was about to be done]
What works: [...]
What's broken or unfinished: [...]
Error messages, if any: [paste exact text]
Current file tree: [paste output of `git ls-files`]
Files I was editing: [paste them in full]

First, tell me in 5 lines what you understand the state to be. Then tell me the next step, and continue step by step as per the working rules in the context file.
```

---

## Prompt 4 — Ask for the Phase report (use at the end of every phase, before switching AI)

```
We're done with Phase [N] (or I'm stopping here). Give me the Phase report in this exact format so I can paste it into section 13 of HACKATHON_CONTEXT.md:

- What was built: files created/changed, one line each
- How to run and verify: commands, URLs, expected output
- Contract changes: routes, schema, env vars, folder names (or "none")
- Decisions made
- Known issues / TODOs
- Exact next step (which phase, which first action)
```

---

## Prompt 5 — Quick sanity check of the whole project (use in the last 6 hours)

```
Review the project against the original requirements in section 1 of HACKATHON_CONTEXT.md. Here is the current file tree and the deployed URL: [paste]. List, for each of the 5 requirements, whether it is fully done, partly done, or missing, and what the smallest fix is. Then list the submission checklist items (live app, repo, demo, Adaption explanation) and what's still missing. Order the fixes by importance given [N] hours left.
```

---

## What to paste when switching AIs (checklist)

1. HACKATHON_CONTEXT.md with section 13 up to date
2. Prompt 1 (new AI) or Prompt 2 / 3 (AI already briefed)
3. `git ls-files` output
4. Full text of the files the next step will touch
5. Any error messages, exactly as shown
