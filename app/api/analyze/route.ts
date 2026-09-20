import Anthropic from "@anthropic-ai/sdk";
import { AnalyzeRequest, AnalyzeResponse, RankedBullet } from "@/lib/types";

// Two sequential Claude calls per request:
//  1. Rank every submitted bullet against the JD (buildRankingPrompt).
//  2. Generate follow-up questions + specificity, but only for the
//     top-ranked bullets from step 1 (buildDefensibilityPrompt).
// Each call's raw text is parsed and validated independently before either
// result is trusted — see callClaudeForJson / isValidRanking /
// isValidDefensibility below.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
 * Type guard for Stage 1's parsed JSON. Claude is asked to return this exact
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
 * Sends one prompt to Claude and JSON.parses its text response. Returns
 * `unknown` deliberately — this doesn't validate the shape, so every caller
 * must run the result through the matching isValid* type guard before
 * trusting it (this function only guarantees "valid JSON", not "the JSON we
 * asked for").
 */
async function callClaudeForJson(prompt: string): Promise<unknown> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === "text");

  if (!textBlock) {
    throw new Error("Claude did not return a text response.");
  }

  return JSON.parse(textBlock.text);
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
    ranking = await callClaudeForJson(
      buildRankingPrompt(resumeBullets, jobDescription)
    );
  } catch {
    return Response.json(
      { error: "Claude's ranking response was not valid JSON." },
      { status: 502 }
    );
  }

  if (!isValidRanking(ranking)) {
    return Response.json(
      { error: "Claude's ranking response didn't match the expected shape." },
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
    defensibility = await callClaudeForJson(
      buildDefensibilityPrompt(
        topBullets.map((bullet) => bullet.bulletText),
        jobDescription
      )
    );
  } catch {
    return Response.json(
      { error: "Claude's defensibility response was not valid JSON." },
      { status: 502 }
    );
  }

  if (
    !isValidDefensibility(defensibility) ||
    defensibility.length !== topBullets.length
  ) {
    return Response.json(
      {
        error:
          "Claude's defensibility response didn't match the expected shape.",
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
