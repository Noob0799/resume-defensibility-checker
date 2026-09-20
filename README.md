# Resume Tailor + Defensibility Checker

**[Live demo →](https://resume-defensibility-checker.vercel.app/)**

Paste your resume bullets and a job description. Every bullet gets ranked by relevance to the JD, and anything relevant enough gets stress-tested for how it would hold up under interview questioning — a specificity score, notes on what's vague, and the follow-up questions an interviewer would likely ask.

Built as a portfolio project for my own job search: tailoring bullets against a JD, then stress-testing them for defensibility, is a workflow I was already doing by hand.

## How it works

Paste resume bullets and a job description, and Gemini scores every bullet's relevance to the JD (1-5, with a one-line reason) in a single call. Bullets scoring 3 or higher also get a defensibility pass: a specificity score (1-5), notes on what's vague or concrete, and 2-3 skeptical follow-up questions an interviewer would likely ask.

## Tech stack

**Next.js (App Router) + React + TypeScript** for one codebase covering the frontend and the API route, the **Google Gemini API** (`@google/genai`) for ranking and defensibility analysis on a free-tier model, and **Vercel** for deployment. No database, no auth, no persistence — resume/JD text lives in memory for the session only.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000. You'll need a `GEMINI_API_KEY` in your environment — see `app/api/analyze/route.ts`.

## API

`POST /api/analyze`

```
{ resumeBullets: string[], jobDescription: string } → { rankedBullets: RankedBullet[] }
```

Types are defined in `lib/types.ts` and shared between the frontend and the API route.
