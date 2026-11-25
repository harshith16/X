/**
 * Real Tweet Verification via X (Twitter) oEmbed endpoint.
 * Zero API keys, $0 budget.
 * Fetches server-side with strict URL gating and matching.
 */

export interface TwitterOEmbedResponse {
  url: string;
  author_name: string;
  author_url: string;
  html: string;
  width?: number;
  height?: number | null;
  type?: string;
  provider_name?: string;
  provider_url?: string;
  version?: string;
}

export type TweetUrlValidationResult =
  | { valid: true; canonicalUrl: string; handle: string; statusId: string }
  | { valid: false; reason: string };

const TWEET_STATUS_REGEX =
  /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]{1,50})\/status\/(\d+)(?:\/|\?.*)?$/i;

const PROFILE_URL_REGEX =
  /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]{1,50})\/?(?:\?.*)?$/i;

/**
 * Validates that the input is strictly an X/Twitter status URL.
 * Rejects profile links and non-status URLs with human plain reasons.
 */
export function validateTweetUrl(url: string): TweetUrlValidationResult {
  if (!url || typeof url !== "string") {
    return {
      valid: false,
      reason: "Please provide a tweet URL.",
    };
  }

  const trimmed = url.trim();

  // If user pasted a profile URL instead of a status URL
  if (PROFILE_URL_REGEX.test(trimmed) && !trimmed.toLowerCase().includes("/status/")) {
    return {
      valid: false,
      reason: "We couldn't find that post — make sure the link is the public tweet, not your profile.",
    };
  }

  const match = trimmed.match(TWEET_STATUS_REGEX);
  if (!match) {
    return {
      valid: false,
      reason: "Invalid tweet link. Make sure it is a public post link like https://x.com/username/status/123456",
    };
  }

  const handle = match[1];
  const statusId = match[2];
  const canonicalUrl = `https://x.com/${handle}/status/${statusId}`;

  return {
    valid: true,
    canonicalUrl,
    handle,
    statusId,
  };
}

/**
 * Fetches oEmbed payload from X's publish endpoint server-side.
 * Timeout defaults to 8 seconds.
 */
export async function fetchOEmbed(
  tweetUrl: string,
  timeoutMs: number = 8000,
): Promise<{ status: number; data: TwitterOEmbedResponse | null }> {
  const oEmbedEndpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const res = await fetch(oEmbedEndpoint, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timer);

    if (res.status === 200) {
      const data = (await res.json()) as TwitterOEmbedResponse;
      return { status: 200, data };
    }

    return { status: res.status, data: null };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Verification timed out connecting to X. Please try again.");
    }
    throw err;
  }
}

/**
 * Extracts author handle from oEmbed response.
 */
export function extractAuthorHandle(authorUrl?: string, html?: string): string | null {
  if (authorUrl) {
    const match = authorUrl.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,50})/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  if (html) {
    // Try to extract from &mdash; Name (@handle) or twitter.com/handle
    const parenMatch = html.match(/@([a-zA-Z0-9_]{1,50})\)/i);
    if (parenMatch?.[1]) {
      return parenMatch[1].toLowerCase();
    }

    const urlMatch = html.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,50})/i);
    if (urlMatch?.[1]) {
      return urlMatch[1].toLowerCase();
    }
  }

  return null;
}

export interface VerifyTweetMatchingParams {
  oEmbedStatus: number;
  oEmbedData: TwitterOEmbedResponse | null;
  expectedXHandle: string;
  expectedAgentHandle: string;
}

export interface VerifyTweetMatchingResult {
  verified: boolean;
  reason?: string;
  authorHandle?: string;
}

/**
 * Deterministically checks:
 * (a) oEmbed returns 200 -> post exists and is public
 * (b) oEmbed author handle matches user's registered X handle
 * (c) oEmbed html contains claim token (agent handle / claim link)
 */
export function verifyTweetMatching({
  oEmbedStatus,
  oEmbedData,
  expectedXHandle,
  expectedAgentHandle,
}: VerifyTweetMatchingParams): VerifyTweetMatchingResult {
  // Check (a): oEmbed returns 200
  if (oEmbedStatus !== 200 || !oEmbedData) {
    return {
      verified: false,
      reason: "We couldn't find that post — make sure the post is public and the link is correct.",
    };
  }

  // Check (b): Author handle matches expected X handle
  const authorHandle = extractAuthorHandle(oEmbedData.author_url, oEmbedData.html);
  if (!authorHandle) {
    return {
      verified: false,
      reason: "Could not verify post author from X. Please ensure the post is public.",
    };
  }

  const cleanExpectedX = expectedXHandle.trim().toLowerCase().replace(/^@/, "");
  if (authorHandle.toLowerCase() !== cleanExpectedX) {
    return {
      verified: false,
      authorHandle,
      reason: `This post was made by @${authorHandle}, but your registered X handle is @${cleanExpectedX}.`,
    };
  }

  // Check (c): Post contains claim token (the unique claim code/link the pre-written tweet carries)
  const cleanAgentHandle = expectedAgentHandle.trim().toLowerCase().replace(/^@/, "");
  const lowerHtml = (oEmbedData.html || "").toLowerCase();

  // Extract tweet body from <p ...>(.*?)</p> if possible
  const pMatch = oEmbedData.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const tweetBody = (pMatch ? pMatch[1] : lowerHtml).toLowerCase();

  const hasHandleToken =
    tweetBody.includes(`@${cleanAgentHandle}`) || tweetBody.includes(cleanAgentHandle);
  const hasBrandOrLinkToken =
    tweetBody.includes("qurelium") || tweetBody.includes("/claim") || tweetBody.includes("claim");

  if (!hasHandleToken || !hasBrandOrLinkToken) {
    return {
      verified: false,
      authorHandle,
      reason: "The post was found, but it doesn't contain your claim code or link.",
    };
  }

  return {
    verified: true,
    authorHandle,
  };
}
