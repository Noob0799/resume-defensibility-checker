<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Resume Tailor + Defensibility Checker

Paste resume bullets + a job description, get bullets ranked by relevance and
stress-tested for how they'd hold up under interview questioning. A portfolio
project built for Sayantan Roy's own job search — the workflow it automates
(tailoring bullets against a JD, then stress-testing them for defensibility)
is one he was already doing by hand.

## Tech stack

- Next.js (App Router) + React + TypeScript — one codebase for frontend and
  API route.
- LLM: Google Gemini API (`@google/genai`, model `gemini-3.6-flash`, pinned
  rather than using the `gemini-flash-latest` alias — see route.ts for why)
  — switched from the originally-planned Anthropic Claude API on 2026-09-15
  specifically to stay on a genuinely free tier rather than pay-as-you-go
  billing. See `app/api/analyze/route.ts` for the implementation.
- No database, no auth, no persistence for v1 — resume/JD text lives in
  memory for the session only.
- Deploy target: Vercel.

## Architecture

One LLM call inside `app/api/analyze/route.ts`, given the full bullet list +
JD: scores every bullet's relevance (1-5 + one-line reason), and generates
defensibility analysis (2-3 follow-up questions, a specificity score, and
specificity notes) for whichever bullets it scores `relevanceScore >= 3` —
that threshold is stated directly in the prompt, so the model itself
decides per-bullet, independently, whether to include those three fields.

This used to be two sequential calls — ranking first, then a second call
generating defensibility only for the top-ranked bullets — merged into one
call on 2026-09-20 (the free tier's binding constraint turned out to be RPD,
requests/day, not token volume, so halving the request count mattered more
than trimming tokens). The selection mechanism changed again shortly after:
initially our own code picked a fixed top-N after the merged call returned,
but since a per-bullet threshold is a simpler ask for the model than
self-selecting "the top N" (no need to compare bullets against each other),
the threshold now lives in the prompt itself and there's no server-side
trim step at all — whatever the model includes is what's returned.

The prompt's rule is only a request, though — `sanitizeAnalysis` in
`route.ts` is what actually enforces it server-side (dropping malformed or
rule-violating defensibility data per bullet rather than failing the whole
request), and the frontend trusts field presence alone rather than
re-deriving the `>= 3` rule itself — that threshold lives in exactly one
place.

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
   containing `followUpQuestions`; bullets that didn't qualify for
   defensibility data get a short note explaining why instead.

## Build order

1. Static UI with hardcoded fake results — layout and component structure.
2. Stage 1 only — wire up real ranking, see it work end-to-end.
3. Stage 2 — add the defensibility layer on top.
4. Error handling + input validation (empty fields, API failures, malformed
   JSON from the LLM).
5. Deploy to Vercel, get a live link.
