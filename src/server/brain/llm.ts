import { logger } from "@/lib/logger";

export interface RecordedLlmPayload {
  question: string;
  context: string;
  approvedFacts: string[];
  timestamp: number;
}

// Global in-memory record so tests and workers can inspect it
const globalForLlm = globalThis as unknown as {
  __recordedLlmPayloads?: RecordedLlmPayload[];
};

export const recordedLlmPayloads: RecordedLlmPayload[] =
  (globalForLlm.__recordedLlmPayloads ??= []);

export function clearRecordedLlmPayloads(): void {
  recordedLlmPayloads.length = 0;
}

/**
 * Calls Gemini or deterministic stub if BRAIN_FAKE_LLM is enabled.
 */
export async function draftAnswer(
  question: string,
  approvedFactTexts: string[],
  requestId: string,
): Promise<string> {
  const context = approvedFactTexts.map((f, i) => `Fact ${i + 1}: ${f}`).join("\n");

  // Fake mode for offline determinism and locked-box verification
  if (process.env.BRAIN_FAKE_LLM === "true") {
    recordedLlmPayloads.push({
      question,
      context,
      approvedFacts: [...approvedFactTexts],
      timestamp: Date.now(),
    });

    return `According to my records: ${approvedFactTexts.join(". ")}`;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn({
      msg: "No GEMINI_API_KEY present for LLM drafting; falling back to stub",
      request_id: requestId,
    });
    return `According to my records: ${approvedFactTexts.join(". ")}`;
  }

  const model = process.env.LLM_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const promptText = `You are an AI agent representing your owner in conversation with a friend's agent.
Answer the following question using ONLY the provided verified facts.
Keep your response concise, friendly, and natural.

Verified facts:
${context}

Question:
${question}

Answer:`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: promptText }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(10000), // 10s external call timeout per docs/RELIABILITY.md
    });

    if (!res.ok) {
      logger.error({
        msg: `Gemini LLM call failed with status ${res.status}`,
        request_id: requestId,
      });
      return `According to my records: ${approvedFactTexts.join(". ")}`;
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (reply) {
      return reply;
    }

    return `According to my records: ${approvedFactTexts.join(". ")}`;
  } catch (err: unknown) {
    logger.error({
      msg: `Error calling Gemini LLM: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });
    return `According to my records: ${approvedFactTexts.join(". ")}`;
  }
}
