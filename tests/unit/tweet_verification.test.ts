import { describe, expect, it, beforeEach } from "vitest";
import {
  validateTweetUrl,
  extractAuthorHandle,
  verifyTweetMatching,
  type TwitterOEmbedResponse,
} from "@/server/identity/tweet_verifier";
import { checkRateLimit, resetRateLimit } from "@/server/identity/rate_limit";

describe("Tweet URL Validation", () => {
  it("accepts valid https x.com status URLs", () => {
    const res = validateTweetUrl("https://x.com/jack/status/20");
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.canonicalUrl).toBe("https://x.com/jack/status/20");
      expect(res.handle).toBe("jack");
      expect(res.statusId).toBe("20");
    }
  });

  it("accepts valid https twitter.com status URLs", () => {
    const res = validateTweetUrl("https://twitter.com/jack/status/20");
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.canonicalUrl).toBe("https://x.com/jack/status/20");
      expect(res.handle).toBe("jack");
      expect(res.statusId).toBe("20");
    }
  });

  it("accepts status URLs with query parameters and strips them for canonical url", () => {
    const res = validateTweetUrl("https://x.com/alice/status/9876543210?s=20&t=abcdef");
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.canonicalUrl).toBe("https://x.com/alice/status/9876543210");
      expect(res.handle).toBe("alice");
      expect(res.statusId).toBe("9876543210");
    }
  });

  it("accepts status URLs with trailing slash", () => {
    const res = validateTweetUrl("https://x.com/alice/status/9876543210/");
    expect(res.valid).toBe(true);
  });

  it("rejects profile links with plain human reason mentioning public tweet not profile", () => {
    const resX = validateTweetUrl("https://x.com/jack");
    expect(resX.valid).toBe(false);
    if (!resX.valid) {
      expect(resX.reason).toBe(
        "We couldn't find that post — make sure the link is the public tweet, not your profile.",
      );
    }

    const resTwitter = validateTweetUrl("https://twitter.com/alice/");
    expect(resTwitter.valid).toBe(false);
    if (!resTwitter.valid) {
      expect(resTwitter.reason).toBe(
        "We couldn't find that post — make sure the link is the public tweet, not your profile.",
      );
    }
  });

  it("rejects non-https URLs", () => {
    const res = validateTweetUrl("http://x.com/jack/status/20");
    expect(res.valid).toBe(false);
  });

  it("rejects non-status / non-X URLs", () => {
    const resOther = validateTweetUrl("https://facebook.com/jack/posts/20");
    expect(resOther.valid).toBe(false);

    const resNonNumeric = validateTweetUrl("https://x.com/jack/status/notanid");
    expect(resNonNumeric.valid).toBe(false);

    const resEmpty = validateTweetUrl("");
    expect(resEmpty.valid).toBe(false);
  });
});

describe("Author Handle Extraction", () => {
  it("extracts handle from author_url", () => {
    expect(extractAuthorHandle("https://x.com/jack")).toBe("jack");
    expect(extractAuthorHandle("https://twitter.com/Alice_123/")).toBe("alice_123");
  });

  it("extracts handle from HTML when author_url is missing or generic", () => {
    const html =
      '<blockquote class="twitter-tweet"><p>Hello</p>&mdash; Jack Dorsey (@jack) <a href="...">March 21</a></blockquote>';
    expect(extractAuthorHandle(undefined, html)).toBe("jack");
  });
});

describe("Matching Logic with Fixture oEmbed Payloads", () => {
  const matchingFixture: TwitterOEmbedResponse = {
    url: "https://x.com/alice/status/12345",
    author_name: "Alice",
    author_url: "https://x.com/alice",
    html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">I just claimed @super_agent on Qurelium. My agent speaks for me. https://qurelium.com/claim</p>&mdash; Alice (@alice)</blockquote>',
  };

  it("matches when oEmbed 200, author matches, and claim token present", () => {
    const res = verifyTweetMatching({
      oEmbedStatus: 200,
      oEmbedData: matchingFixture,
      expectedXHandle: "alice",
      expectedAgentHandle: "super_agent",
    });

    expect(res.verified).toBe(true);
  });

  it("fails with human reason on author handle mismatch", () => {
    const res = verifyTweetMatching({
      oEmbedStatus: 200,
      oEmbedData: matchingFixture,
      expectedXHandle: "bob",
      expectedAgentHandle: "super_agent",
    });

    expect(res.verified).toBe(false);
    expect(res.reason).toBe("This post was made by @alice, but your registered X handle is @bob.");
  });

  it("fails when claim token is absent from post", () => {
    const missingTokenFixture: TwitterOEmbedResponse = {
      url: "https://x.com/alice/status/12345",
      author_name: "Alice",
      author_url: "https://x.com/alice",
      html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Just enjoying my coffee today.</p>&mdash; Alice (@alice)</blockquote>',
    };

    const res = verifyTweetMatching({
      oEmbedStatus: 200,
      oEmbedData: missingTokenFixture,
      expectedXHandle: "alice",
      expectedAgentHandle: "super_agent",
    });

    expect(res.verified).toBe(false);
    expect(res.reason).toBe("The post was found, but it doesn't contain your claim code or link.");
  });

  it("fails when oEmbed status is 404 or data is null", () => {
    const res = verifyTweetMatching({
      oEmbedStatus: 404,
      oEmbedData: null,
      expectedXHandle: "alice",
      expectedAgentHandle: "super_agent",
    });

    expect(res.verified).toBe(false);
    expect(res.reason).toBe(
      "We couldn't find that post — make sure the post is public and the link is correct.",
    );
  });
});

describe("Rate Limiting", () => {
  const testKey = "user_test_rate_limit";

  beforeEach(() => {
    resetRateLimit(testKey);
  });

  it("allows up to 10 attempts in window and blocks the 11th", () => {
    for (let i = 0; i < 10; i++) {
      const check = checkRateLimit(testKey, 10, 60_000);
      expect(check.allowed).toBe(true);
      expect(check.remaining).toBe(9 - i);
    }

    const blocked = checkRateLimit(testKey, 10, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
