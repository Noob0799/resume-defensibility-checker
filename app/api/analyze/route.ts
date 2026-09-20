import { ApiError, GoogleGenAI } from "@google/genai";
import { AnalyzeRequest, AnalyzeResponse, RankedBullet } from "@/lib/types";

// One Gemini call per request. This used to be two sequential calls (rank,
// then a separate defensibility pass on the top-ranked bullets) — merged on
// 2026-09-20 because the free tier's binding constraint turned out to be
// RPD (requests/day), not token volume, so halving the request count
// mattered more than trimming tokens.
//
// The model is asked to decide per-bullet whether to include defensibility
// fields (follow-up questions + specificity), based on a threshold stated
// in the prompt: relevanceScore >= 3. This was chosen over having the model
// self-select "the top N bullets" because it's a simple absolute rule
// applied independently to each bullet, not a relative judgment across the
// whole set — the model doesn't need to compare bullets against each other
// or agree with itself on a cutoff, just check the score it already gave
// this one bullet. That said, the prompt only asks — sanitizeAnalysis
// (below) is what actually enforces the >= 3 rule server-side and drops
// any malformed or rule-violating defensibility data per bullet, rather
// than trusting the model's compliance or failing the whole request over
// one bullet's imperfection.
//
// Uses Gemini (not Claude) specifically to stay on a genuinely free tier —
// see the project discussion around 2026-09-15 for why.
//
// MODEL is pinned to a specific version rather than the "gemini-flash-latest"
// alias. Verified live on 2026-09-20: "gemini-2.5-flash" is deprecated for
// this key (Google's own error names "gemini-3.6-flash" as the replacement),
// and "gemini-flash-latest" was returning 503 UNAVAILABLE ("high demand")
// at the time — a pinned, known-working version is more reliable for a
// live demo than an alias that can silently point at an overloaded model.
// Worth re-checking this periodically as Google's lineup moves on.

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-3.8-flash";

/**
 * Validates and cleans up the parsed JSON, per bullet, rather than
 * rejecting the whole response over one bullet's imperfect data.
 *
 * bulletText/relevanceScore/relevanceReason are non-negotiable — if any
 * bullet is missing them or has them wrongly typed, there's no sensible
 * bullet to show, so the whole response is rejected (returns null).
 *
 * The three defensibility fields are treated as advisory, not trusted:
 * they're kept only when the model both (a) actually sent all three,
 * well-typed, AND (b) scored that bullet relevanceScore >= 3 — the same
 * threshold stated in the prompt. If the model attaches them despite a low
 * score, or sends a partial/malformed set for any one bullet, they're just
 * dropped for that bullet rather than failing the entire request. This is
 * also the authoritative enforcement of the >= 3 rule: the prompt asks the
 * model to follow it, but this function is what actually guarantees it,
 * regardless of whether the model complies.
 */
function sanitizeAnalysis(value: unknown): RankedBullet[] | null {
  if (!Array.isArray(value)) return null;

  const bullets: RankedBullet[] = [];

  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;

    if (
      typeof record.bulletText !== "string" ||
      typeof record.relevanceScore !== "number" ||
      typeof record.relevanceReason !== "string"
    ) {
      return null;
    }

    const bullet: RankedBullet = {
      bulletText: record.bulletText,
      relevanceScore: record.relevanceScore,
      relevanceReason: record.relevanceReason,
    };

    const hasWellFormedDefensibility =
      Array.isArray(record.followUpQuestions) &&
      record.followUpQuestions.every((q) => typeof q === "string") &&
      typeof record.specificityScore === "number" &&
      typeof record.specificityNotes === "string";

    if (bullet.relevanceScore >= 3 && hasWellFormedDefensibility) {
      bullet.followUpQuestions = record.followUpQuestions as string[];
      bullet.specificityScore = record.specificityScore as number;
      bullet.specificityNotes = record.specificityNotes as string;
    }

    bullets.push(bullet);
  }

  return bullets;
}

/**
 * Combined prompt: for every bullet, score relevance against the JD, and
 * conditionally generate defensibility analysis (follow-up questions +
 * specificity) only for bullets scoring 3 or higher — see the note at the
 * top of this file on why a per-bullet threshold instead of the model
 * picking "the top ones" itself.
 */
function buildAnalysisPrompt(resumeBullets: string[], jobDescription: string) {
  const bulletList = resumeBullets
    .map((bullet, index) => `${index + 1}. ${bullet}`)
    .join("\n");

  return `You are helping a job seeker evaluate their resume bullets against a job description, and preparing them to defend those bullets under skeptical interview questioning.

Job description:
"""
${jobDescription}
"""

Resume bullets:
${bulletList}

For EACH bullet:
1. Score how relevant it is to this job description on a 1-5 scale (5 = directly matches a core requirement in the JD, 1 = unrelated to the JD), and give a one-line reason for the score.
2. If — and only if — that relevance score is 3 or higher, ALSO:
   a. Write 2-3 specific, skeptical follow-up questions an interviewer would likely ask to test whether the claim is real and the candidate can defend it — e.g. their specific role versus the team's, how a metric was actually measured, or what a vague word like "several" or "large" really means here.
   b. Score how specific and concrete the bullet is on a 1-5 scale (5 = concrete, with a clear metric and defined scope; 1 = vague, unverifiable, or likely overclaiming), and give a one-line note explaining what's vague or why it's concrete.
   If the relevance score is below 3, do NOT include followUpQuestions, specificityScore, or specificityNotes for that bullet at all — omit those three keys entirely rather than leaving them empty.

Respond with ONLY a JSON array, no other text before or after it. Every entry must always have "bulletText", "relevanceScore", and "relevanceReason". Entries for bullets scoring 3 or higher must ALSO include "followUpQuestions", "specificityScore", and "specificityNotes". Entries for bullets scoring below 3 must NOT include those three keys.

Example entry for a bullet scoring 3 or higher:
{ "bulletText": "<original text>", "relevanceScore": 4, "relevanceReason": "<one line>", "followUpQuestions": ["<question>", "<question>"], "specificityScore": 3, "specificityNotes": "<one line>" }

Example entry for a bullet scoring below 3:
{ "bulletText": "<original text>", "relevanceScore": 2, "relevanceReason": "<one line>" }

The array must have exactly ${resumeBullets.length} entries, one per bullet, in the same order as listed above.`;
}

/** Thrown by callGeminiForJson when Gemini returns no text to parse at all
 * (e.g. its safety filters blocked the response, or it hit max_tokens
 * before producing any text) — distinct from a malformed-but-present
 * response, which fails at JSON.parse instead. */
class EmptyGeminiResponseError extends Error {}

/**
 * Sends one prompt to Gemini and JSON.parses its text response. Returns
 * `unknown` deliberately — this doesn't validate the shape, so the caller
 * must run the result through sanitizeAnalysis before trusting it (this
 * function only guarantees "valid JSON", not "the JSON we asked for").
 */
async function callGeminiForJson(prompt: string): Promise<unknown> {
  const response = await genAI.models.generateContent({
    model: MODEL,
    contents: prompt,
    // thinkingBudget: 0 disables this model's internal reasoning step.
    // Verified via a direct API call that thinking tokens count against
    // maxOutputTokens (115 total tokens for a 1-word answer, vs. 7 with
    // this disabled) — for a fixed-shape JSON extraction task like ours,
    // that reasoning doesn't help the output and was eating into the
    // budget meant for the actual response.
    config: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
  });

  if (!response.text) {
    throw new EmptyGeminiResponseError("Gemini did not return a text response.");
  }

  return JSON.parse(response.text);
}

/**
 * Turns a raw error thrown by callGeminiForJson into an HTTP status + a
 * user-facing message that actually describes what went wrong. The
 * "wasn't valid JSON" message is reserved for a genuine JSON.parse failure
 * (SyntaxError) — every other failure mode (missing/invalid API key,
 * unknown model, Gemini's own server errors, rate limits, a blocked or
 * empty response) gets its own specific message instead of being lumped
 * into that one, which was previously misleading (e.g. a rate limit or an
 * auth failure both used to show "wasn't valid JSON", even though no
 * response was ever returned to parse in either case).
 */
function classifyGeminiError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return {
        status: 429,
        message:
          "Gemini's free-tier rate limit was hit. Wait a minute and try again.",
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        status: 502,
        message:
          "Gemini rejected the request — the API key is missing, invalid, or lacks permission.",
      };
    }
    if (error.status === 404) {
      return {
        status: 502,
        message: "Gemini couldn't find the requested model.",
      };
    }
    if (error.status >= 500) {
      return {
        status: 502,
        message: "Gemini's servers had an error. Please try again in a moment.",
      };
    }
    return {
      status: 502,
      message: `Gemini rejected the request (status ${error.status}).`,
    };
  }

  if (error instanceof EmptyGeminiResponseError) {
    return {
      status: 502,
      message:
        "Gemini didn't return any content — it may have blocked the response or hit its output limit.",
    };
  }

  if (error instanceof SyntaxError) {
    return { status: 502, message: "Gemini's response wasn't valid JSON." };
  }

  return {
    status: 502,
    message: "Something went wrong talking to Gemini. Please try again.",
  };
}

export async function POST(request: Request) {
  const body: AnalyzeRequest = await request.json();
  const { resumeBullets, jobDescription } = body;

  if (
    !Array.isArray(resumeBullets) ||
    resumeBullets.length === 0 ||
    typeof jobDescription !== "string" ||
    jobDescription.trim().length === 0
  ) {
    return Response.json(
      {
        error:
          "resumeBullets must be a non-empty array and jobDescription must be a non-empty string.",
      },
      { status: 400 }
    );
  }

  let analysis: unknown;
  try {
    analysis = await callGeminiForJson(
      buildAnalysisPrompt(resumeBullets, jobDescription)
    );
  } catch (error) {
    console.error("Analysis call failed:", error);
    const { status, message } = classifyGeminiError(error);
    return Response.json({ error: message }, { status });
  }

  const sanitized = sanitizeAnalysis(analysis);

  if (!sanitized || sanitized.length !== resumeBullets.length) {
    return Response.json(
      { error: "Gemini's response didn't match the expected shape." },
      { status: 502 }
    );
  }

  const rankedBullets: RankedBullet[] = sanitized.sort(
    (a, b) => b.relevanceScore - a.relevanceScore
  );

  const response: AnalyzeResponse = { rankedBullets };

  return Response.json(response);
}
