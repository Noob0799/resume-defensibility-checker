# Test samples

Manual test scenarios for the app — no automated test framework is set up
yet, so these are copy-paste inputs: paste the bullets block into "Resume
bullets" and the JD block into "Job description" in the UI. A curl section
at the bottom covers the API's validation/error paths directly.

---

## 1. Strong match (frontend role)

Mix of concrete, relevant bullets and a couple of vague ones — expect high
relevance across the board, but specificity should clearly separate the
concrete bullets from the vague ones.

**Job description:**
```
Senior Frontend Engineer

We're looking for a Senior Frontend Engineer to help scale our web
application. You'll own features end-to-end using React and TypeScript,
with a strong focus on performance, accessibility, and maintainable code.
Experience with component architecture, state management, and shipping to
production at scale is a must. Bonus points for experience mentoring other
engineers and improving frontend tooling/CI.
```

**Resume bullets:**
```
Led the migration of a 200k-line codebase from JavaScript to TypeScript, reducing production type-errors by 60% over two quarters
Redesigned the checkout flow's component architecture using React Context and custom hooks, cutting re-renders by 35%
Worked on various frontend improvements across the platform
Improved Lighthouse accessibility score from 68 to 96 by auditing and fixing ARIA labeling, color contrast, and keyboard navigation across 40+ components
Mentored two junior engineers and ran a biweekly frontend tooling review that reduced CI build time by 25%
Helped make things faster and more maintainable
```

---

## 2. Weak/no match

Frontend-heavy bullets against an unrelated JD — expect relevance scores
clustered low, and the ranking should still produce a sensible (if
unflattering) order rather than erroring out.

**Job description:**
```
Site Reliability Engineer

We need an SRE to own the reliability of our infrastructure: on-call
rotations, incident response, Kubernetes cluster management, and building
observability tooling (metrics, logging, tracing). Strong Linux and
networking fundamentals required. Experience with Terraform and
infrastructure-as-code is a plus.
```

**Resume bullets:**
```
Built a React component library used across 6 product teams
Designed the visual system and Figma-to-code workflow for the marketing site
Wrote unit tests for the checkout React components, raising coverage from 40% to 85%
```

---

## 3. Vague / overclaiming heavy

Every bullet is unquantified and generic — stresses the specificity scoring
and follow-up question generation specifically; expect most or all of these
to land in the low specificity band with pointed follow-ups.

**Job description:**
```
Backend Engineer (Payments)

Build and maintain services that process financial transactions at scale.
We care deeply about correctness, observability, and measurable impact —
every change should be backed by data. Experience with distributed systems
and high-reliability services expected.
```

**Resume bullets:**
```
Worked on various backend improvements
Helped improve system performance
Collaborated with team members on several projects
Responsible for maintaining backend services
Assisted in improving reliability of the platform
```

---

## 4. Edge cases

- **Single bullet only** (fewer than `TOP_N_FOR_DEFENSIBILITY`):
  ```
  Cut API p95 latency from 800ms to 210ms by adding Redis caching to the pricing service
  ```

- **More than 3 bullets** (to confirm only the top 3 get follow-up
  questions/specificity, and the rest render with relevance only):
  ```
  Cut API p95 latency from 800ms to 210ms by adding Redis caching to the pricing service
  Migrated the CI pipeline from Jenkins to GitHub Actions, reducing average build time from 14 to 6 minutes
  Designed and shipped a rate-limiting middleware used by all 12 internal services
  Wrote internal documentation for the onboarding process
  Attended sprint planning and stand-ups regularly
  Fixed several bugs reported by QA
  ```

- **Special characters / quotes** (stresses JSON-escaping through the
  prompt → Gemini → JSON.parse round trip):
  ```
  Reduced page load by ~40% using "lazy loading" & code-splitting (see: webpack config)
  Built a "smart" retry mechanism handling 99.9% of transient failures — no manual intervention needed
  ```

- **Blank lines between bullets** (tests `InputForm`'s
  split/trim/filter-empty-lines logic — should behave identically to the
  same bullets with no blank lines):
  ```
  Owned the migration to TypeScript for the core web app

  Led the redesign of the checkout flow, reducing cart abandonment by 18%

  Worked on various frontend improvements across the platform
  ```

---

## Direct API testing (curl)

Useful for exercising validation/error paths without going through the UI.
Requires the dev server running (`npm run dev`) and a valid `GEMINI_API_KEY`
in `.env.local` for the success cases.

**Valid request:**
```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "resumeBullets": [
      "Led the redesign of the checkout flow, reducing cart abandonment by 18%",
      "Worked on various frontend improvements across the platform"
    ],
    "jobDescription": "Senior Frontend Engineer with React and TypeScript experience, focused on conversion optimization."
  }'
```

**Empty bullets array (expect 400):**
```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"resumeBullets": [], "jobDescription": "Some JD text"}'
```

**Empty/whitespace-only job description (expect 400):**
```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"resumeBullets": ["Did a thing"], "jobDescription": "   "}'
```

**Missing fields entirely (expect 400):**
```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Invalid API key (expect 502, "API key is missing, invalid, or lacks permission" —**
**temporarily set `GEMINI_API_KEY` to garbage in `.env.local` and restart the dev server to trigger this):**
```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"resumeBullets": ["Did a thing"], "jobDescription": "Some JD text"}'
```
