@AGENTS.md

# Resume Tailor + Defensibility Checker

Paste resume bullets + a job description, get bullets ranked by relevance and
stress-tested for how they'd hold up under interview questioning. A portfolio
project built for Sayantan Roy's own job search — the workflow it automates
(tailoring bullets against a JD, then stress-testing them for defensibility)
is one he was already doing by hand.

## Tech stack

- Next.js (App Router) + React + TypeScript — one codebase for frontend and
  API route.
- LLM: Anthropic Claude API.
- No database, no auth, no persistence for v1 — resume/JD text lives in
  memory for the session only.
- Deploy target: Vercel.

## Architecture

Two-stage LLM pipeline inside `app/api/analyze/route.ts` (not yet created):

1. **Ranking** — one LLM call, given the full bullet list + JD, ranks bullets
   by relevance to this JD with a one-line reason each.
2. **Defensibility** — a second LLM call, but ONLY on the top-ranked bullets
   from stage 1 — generates 2-3 likely interviewer follow-up questions, a
   specificity score, and specificity notes.

## API contract

Defined in [`lib/types.ts`](lib/types.ts) — `AnalyzeRequest`,
`AnalyzeResponse`, `RankedBullet`. Import from there on both the frontend and
the API route; don't redefine these types elsewhere.

`POST /api/analyze` — request `{ resumeBullets: string[], jobDescription: string }`
→ response `{ rankedBullets: RankedBullet[] }`.

## Frontend

Component tree (plain `useState`/`useReducer`, no Redux/Context):

```
app/page.tsx ("use client" — root, holds state)
 ├─ InputForm       (resume bullets textarea, JD textarea, submit button)
 ├─ LoadingState    (shown while the API call is in flight)
 ├─ ResultsList
 │   └─ BulletCard  (see UI spec below)
 └─ ErrorState      (API failure / empty-input handling)
```

### BulletCard UI spec (top to bottom)

1. Badge row: relevance badge (neutral/accent — it's a ranking, not a
   warning) + specificity badge (color-coded: 4-5 = success/green, 3 =
   warning/amber, 1-2 = danger/red).
2. Bullet text.
3. `relevanceReason` — always visible, small muted line.
4. `specificityNotes` — always visible, small muted line.
5. Divider, then a collapsible panel (default open, toggle to collapse)
   containing `followUpQuestions`.

## Build order

1. Static UI with hardcoded fake results — layout and component structure.
2. Stage 1 only — wire up real ranking, see it work end-to-end.
3. Stage 2 — add the defensibility layer on top.
4. Error handling + input validation (empty fields, API failures, malformed
   JSON from the LLM).
5. Deploy to Vercel, get a live link.