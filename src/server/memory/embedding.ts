import { logger } from "@/lib/logger";

/**
 * Generates vector(768) embedding using Gemini text-embedding-004 API.
 * If GEMINI_API_KEY is absent or request fails/times out, returns null.
 */
export async function embedText(
  text: string,
  requestId?: string,
): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: {
          parts: [{ text }],
        },
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout per docs/RELIABILITY.md
    });

    if (!res.ok) {
      if (requestId) {
        logger.warn({
          msg: `Gemini embedding API returned status ${res.status}`,
          request_id: requestId,
        });
      }
      return null;
    }

    const data = (await res.json()) as {
      embedding?: { values?: number[] };
    };

    if (data.embedding?.values && Array.isArray(data.embedding.values)) {
      return data.embedding.values;
    }

    return null;
  } catch (err: unknown) {
    if (requestId) {
      logger.warn({
        msg: `Failed to generate embedding: ${err instanceof Error ? err.message : String(err)}`,
        request_id: requestId,
      });
    }
    return null;
  }
}
