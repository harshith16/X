import { describe, expect, it } from "vitest";
import { HandleSchema } from "@/types/agent";
import { checkHandleAvailability, ClaimError } from "@/server/identity/claim";

describe("Handle validation", () => {
  it("accepts valid handles (lowercase letters, numbers, underscores, 3-24 chars)", () => {
    const validHandles = ["agent", "agent_123", "a1_", "my_super_agent_handle", "bob", "alex123"];
    for (const h of validHandles) {
      const res = HandleSchema.safeParse(h);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toBe(h.toLowerCase());
      }
    }
  });

  it("normalizes uppercase letters to lowercase", () => {
    const res = HandleSchema.safeParse("MyAgent");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe("myagent");
    }
  });

  it("rejects handles shorter than 3 characters", () => {
    const res = HandleSchema.safeParse("ab");
    expect(res.success).toBe(false);
  });

  it("rejects handles longer than 24 characters", () => {
    const res = HandleSchema.safeParse("a".repeat(25));
    expect(res.success).toBe(false);
  });

  it("rejects handles with invalid characters", () => {
    const invalidHandles = ["agent-one", "agent.one", "agent@one", "agent name", "agent!"];
    for (const h of invalidHandles) {
      const res = HandleSchema.safeParse(h);
      expect(res.success).toBe(false);
    }
  });
});

describe("checkHandleAvailability validation fast path", () => {
  it("throws ClaimError 400 without touching database for bad formats", async () => {
    await expect(checkHandleAvailability("a!", "test-req-id")).rejects.toThrowError(
      ClaimError,
    );
  });

  it("throws ClaimError 400 for handles that are too short", async () => {
    await expect(checkHandleAvailability("yo", "test-req-id")).rejects.toThrowError(
      ClaimError,
    );
  });
});

describe("ClaimError", () => {
  it("creates error with code, message, and statusCode", () => {
    const err = new ClaimError("HANDLE_TAKEN", "That name was just taken.", 409);
    expect(err.code).toBe("HANDLE_TAKEN");
    expect(err.message).toBe("That name was just taken.");
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe("ClaimError");
  });
});
