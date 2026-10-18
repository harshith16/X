import { describe, expect, it } from "vitest";
import { envSchema, validateEnv } from "@/lib/env";

describe("env validation", () => {
  const validPlaceholderEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "placeholder-publishable-key",
    SUPABASE_SECRET_KEY: "placeholder-secret-key",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    CLAIM_CODE_SECRET: "placeholder-claim-code-secret",
    AGENT_TOKEN_SECRET: "placeholder-agent-token-secret",
    EMBEDDING_PROVIDER: "gemini",
    GEMINI_API_KEY: "placeholder-gemini-key",
    RESEND_API_KEY: "placeholder-resend-key",
    EMAIL_FROM: "placeholder-email-from@qurelium.com",
  };

  it("proves the env schema accepts a valid placeholder-shaped env", () => {
    const result = envSchema.safeParse(validPlaceholderEnv);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.NEXT_PUBLIC_SUPABASE_URL).toBe("https://placeholder.supabase.co");
      expect(result.data.EMBEDDING_PROVIDER).toBe("gemini");
    }
  });

  it("defaults EMBEDDING_PROVIDER to gemini when omitted", () => {
    const envWithoutProvider = { ...validPlaceholderEnv };
    delete (envWithoutProvider as Partial<typeof validPlaceholderEnv>).EMBEDDING_PROVIDER;

    const result = envSchema.safeParse(envWithoutProvider);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.EMBEDDING_PROVIDER).toBe("gemini");
    }
  });

  it("proves the env schema rejects one missing a required variable", () => {
    const missingRequired = { ...validPlaceholderEnv };
    delete (missingRequired as Partial<typeof validPlaceholderEnv>).NEXT_PUBLIC_SUPABASE_URL;

    const result = envSchema.safeParse(missingRequired);
    expect(result.success).toBe(false);

    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("NEXT_PUBLIC_SUPABASE_URL"));
      expect(issue).toBeDefined();
    }
  });

  it("proves validateEnv throws listing missing variables", () => {
    const missingKey = { ...validPlaceholderEnv };
    delete (missingKey as Partial<typeof validPlaceholderEnv>).SUPABASE_SECRET_KEY;

    expect(() => validateEnv(missingKey)).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("rejects non-URL strings for URL fields", () => {
    const invalidUrlEnv = {
      ...validPlaceholderEnv,
      NEXT_PUBLIC_APP_URL: "not-a-valid-url",
    };
    const result = envSchema.safeParse(invalidUrlEnv);
    expect(result.success).toBe(false);
  });

  it("accepts DEV_TEST_LOGIN when provided", () => {
    const envWithDevLogin = {
      ...validPlaceholderEnv,
      DEV_TEST_LOGIN: "true",
    };
    const result = envSchema.safeParse(envWithDevLogin);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DEV_TEST_LOGIN).toBe("true");
    }
  });
});
