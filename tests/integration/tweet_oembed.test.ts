import { describe, expect, it } from "vitest";
import { fetchOEmbed, extractAuthorHandle } from "@/server/identity/tweet_verifier";

describe("Live X oEmbed Integration (Mechanism Proof)", () => {
  it("successfully fetches public tweet via oEmbed server-side and parses author", async () => {
    const realTweetUrl = "https://x.com/jack/status/20";
    const res = await fetchOEmbed(realTweetUrl, 8000);

    expect(res.status).toBe(200);
    expect(res.data).not.toBeNull();
    if (res.data) {
      expect(res.data.author_name.toLowerCase()).toBe("jack");
      expect(res.data.author_url).toContain("jack");
      expect(res.data.html).toContain("just setting up my twttr");

      const parsedHandle = extractAuthorHandle(res.data.author_url, res.data.html);
      expect(parsedHandle).toBe("jack");
    }
  }, 10000);

  it("returns 404 for non-existent status ID", async () => {
    const nonexistentUrl = "https://x.com/jack/status/999999999999999999999999";
    const res = await fetchOEmbed(nonexistentUrl, 8000);

    expect(res.status).toBe(404);
    expect(res.data).toBeNull();
  }, 10000);
});
