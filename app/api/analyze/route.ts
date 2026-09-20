import { ApiError, GoogleGenAI } from "@google/genai";
import { AnalyzeRequest, AnalyzeResponse, RankedBullet } from "@/lib/types";

// Two sequential Gemini calls per request:
//  1. Rank every submitted bullet against the JD (buildRankingPrompt).
//  2. Generate follow-up questions + specificity, but only for the
//     top-ranked bullets from step 1 (buildDefensibilityPrompt).
// Each call's raw text is parsed and validated independently before either
// result is trusted — see callGeminiForJson / isValidRanking /
// isValidDefensibility below.
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
const MODEL = "gemini-3.6-flash";

// For now, the analysis only runs on the 3 top-ranked bullets, to keep its token cost down.
const TOP_N_FOR_DEFENSIBILITY = 3;

type RankingResult = Pick<
  RankedBullet,
  "bulletText" | "relevanceScore" | "relevanceReason"
>;

type DefensibilityResult = Pick<
  RankedBullet,
  "followUpQuestions" | "specificityScore" | "specificityNotes"
>;

/**
 * Type guard for Stage 1's parsed JSON. Gemini is asked to return this exact
 * shape, but nothing enforces that — every field is checked explicitly
 * rather than trusted, so a malformed response fails loudly (502) instead
 * of reaching the frontend as bad data.
 */
function isValidRanking(value: unknown): value is RankingResult[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).bulletText === "string" &&
        typeof (item as Record<string, unknown>).relevanceScore === "number" &&
        typeof (item as Record<string, unknown>).relevanceReason === "string"
    )
  );
}

/** Same purpose as isValidRanking, for Stage 2's parsed JSON. */
function isValidDefensibility(value: unknown): value is DefensibilityResult[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (typeof item !== "object" || item === null) return false;
      const record = item as Record<string, unknown>;
      return (
        Array.isArray(record.followUpQuestions) &&
        record.followUpQuestions.every((q) => typeof q === "string") &&
        typeof record.specificityScore === "number" &&
        typeof record.specificityNotes === "string"
      );
    })
  );
}

/** Stage 1 prompt: score every submitted bullet's relevance to the JD. */
function buildRankingPrompt(resumeBullets: string[], jobDescription: string) {
  const bulletList = resumeBullets
    .map((bullet, index) => `${index + 1}. ${bullet}`)
    .join("\n");

  return `You are helping a job seeker evaluate how well their resume bullets match a job description.

Job description:
"""
${jobDescription}
"""

Resume bullets:
${bulletList}

For each bullet, score how relevant it is to this job description on a 1-5 scale (5 = directly matches a core requirement in the JD, 1 = unrelated to the JD), and give a one-line reason for the score.

Respond with ONLY a JSON array, no other text before or after it, in exactly this shape:
[
  { "bulletText": "<the original bullet, unchanged>", "relevanceScore": <integer 1-5>, "relevanceReason": "<one line>" }
]

The array must have exactly ${resumeBullets.length} entries, one per bullet, in the same order as listed above.`;
}

/**
 * Stage 2 prompt: generates follow-up questions + specificity for whichever
 * bullets the caller passes in — the caller (POST below) is responsible for
 * only passing the top-ranked ones.
 */
function buildDefensibilityPrompt(bullets: string[], jobDescription: string) {
  const bulletList = bullets
    .map((bullet, index) => `${index + 1}. ${bullet}`)
    .join("\n");

  return `You are a skeptical technical interviewer preparing to question a candidate about their resume, for a role with this job description:

"""
${jobDescription}
"""

For each of the following resume bullets:
1. Write 2-3 specific, skeptical follow-up questions an interviewer would likely ask to test whether the claim is real and the candidate can defend it — e.g. their specific role versus the team's, how a metric was actually measured, or what a vague word like "several" or "large" really means here.
2. Score how specific and concrete the bullet is on a 1-5 scale (5 = concrete, with a clear metric and defined scope; 1 = vague, unverifiable, or likely overclaiming), and give a one-line note explaining what's vague or why it's concrete.

Bullets:
${bulletList}

Respond with ONLY a JSON array, no other text before or after it, in exactly this shape:
[
  { "followUpQuestions": ["<question>", "<question>"], "specificityScore": <integer 1-5>, "specificityNotes": "<one line>" }
]

The array must have exactly ${bullets.length} entries, one per bullet, in the same order as listed above.`;
}

/**
 * Sends one prompt to Gemini and JSON.parses its text response. Returns
 * `unknown` deliberately — this doesn't validate the shape, so every caller
 * must run the result through the matching isValid* type guard before
 * trusting it (this function only guarantees "valid JSON", not "the JSON we
 * asked for").
 */
/** Thrown by callGeminiForJson when Gemini returns no text to parse at all
 * (e.g. its safety filters blocked the response, or it hit max_tokens
 * before producing any text) — distinct from a malformed-but-present
 * response, which fails at JSON.parse instead. */
class EmptyGeminiResponseError extends Error {}

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
    config: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
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

  let ranking: unknown;
  try {
    ranking = await callGeminiForJson(
      buildRankingPrompt(resumeBullets, jobDescription)
    );
  } catch (error) {
    console.error("Stage 1 (ranking) call failed:", error);
    const { status, message } = classifyGeminiError(error);
    return Response.json({ error: message }, { status });
  }

  if (!isValidRanking(ranking)) {
    return Response.json(
      { error: "Gemini's ranking response didn't match the expected shape." },
      { status: 502 }
    );
  }

  const rankedBullets: RankedBullet[] = [...ranking].sort(
    (a, b) => b.relevanceScore - a.relevanceScore
  );

  // .slice() copies the array, not the objects inside it — topBullets[i]
  // and rankedBullets[i] are the SAME object for i < TOP_N_FOR_DEFENSIBILITY.
  // That's intentional: it's what lets the Object.assign below update both
  // arrays through one mutation instead of writing a separate merge step.
  const topBullets = rankedBullets.slice(0, TOP_N_FOR_DEFENSIBILITY);

  let defensibility: unknown;
  try {
    defensibility = await callGeminiForJson(
      buildDefensibilityPrompt(
        topBullets.map((bullet) => bullet.bulletText),
        jobDescription
      )
    );
  } catch (error) {
    console.error("Stage 2 (defensibility) call failed:", error);
    const { status, message } = classifyGeminiError(error);
    return Response.json({ error: message }, { status });
  }

  if (
    !isValidDefensibility(defensibility) ||
    defensibility.length !== topBullets.length
  ) {
    return Response.json(
      {
        error:
          "Gemini's defensibility response didn't match the expected shape.",
      },
      { status: 502 }
    );
  }

  // Merges Stage 2's fields onto the existing Stage 1 objects in place —
  // it doesn't replace them, so bulletText/relevanceScore/relevanceReason
  // are untouched. Because topBullets shares references with rankedBullets
  // (see above), this also updates the matching entries in rankedBullets.
  defensibility.forEach((result, index) => {
    Object.assign(topBullets[index], result);
  });

  // rankedBullets holds every submitted bullet, not just the top-ranked
  // ones — only the first TOP_N_FOR_DEFENSIBILITY entries carry
  // followUpQuestions/specificityScore/specificityNotes after the merge
  // above; the rest are Stage 1 data only (those fields are optional on
  // RankedBullet for exactly this reason — see lib/types.ts).
  const response: AnalyzeResponse = { rankedBullets };

  return Response.json(response);
}
