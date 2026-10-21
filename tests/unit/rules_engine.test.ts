import { describe, expect, it } from "vitest";
import {
  evaluateRules,
  runRulesEngine,
  extractKeywords,
  scoreTokenOverlap,
  RulesEngineCandidate,
  RulesEngineContext,
} from "@/server/rules/engine";

describe("Rules Engine - Deterministic Security Core", () => {
  const baseContext: RulesEngineContext = {
    owner_id: "owner_123",
    agent_id: "agent_456",
    conversation_id: "conv_789",
  };

  describe("Token overlap matching", () => {
    it("extracts non-stopword tokens accurately", () => {
      const keywords = extractKeywords("What are the travel dates for Goa?");
      expect(keywords.has("travel")).toBe(true);
      expect(keywords.has("dates")).toBe(true);
      expect(keywords.has("goa")).toBe(true);
      expect(keywords.has("what")).toBe(false);
      expect(keywords.has("the")).toBe(false);
      expect(keywords.has("for")).toBe(false);
    });

    it("scores token overlap between question and fact text", () => {
      const qTokens = extractKeywords("When is the Tokyo conference flight?");
      const fact1 = "Tokyo conference flight is on October 25";
      const fact2 = "London hotel booking details";

      expect(scoreTokenOverlap(qTokens, fact1)).toBeGreaterThanOrEqual(3);
      expect(scoreTokenOverlap(qTokens, fact2)).toBe(0);
    });
  });

  describe("Share answers", () => {
    it("returns action 'answer' with matching share fact IDs", () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_share_1",
          text: "Favorite coffee is oat milk cappuccino",
          share_rule: "share",
        },
      ];

      const result = evaluateRules(facts, "What is their favorite coffee?", baseContext);
      expect(result.action).toBe("answer");
      if (result.action === "answer") {
        expect(result.fact_ids).toEqual(["f_share_1"]);
      }
    });
  });

  describe("Ask creates approval", () => {
    it("returns action 'ask' when matching fact has share_rule 'ask'", () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_ask_1",
          text: "Goa trip dates are November 10 to November 15",
          share_rule: "ask",
        },
      ];

      const result = evaluateRules(facts, "What are the Goa trip dates?", baseContext);
      expect(result.action).toBe("ask");
      if (result.action === "ask") {
        expect(result.fact_ids).toContain("f_ask_1");
        expect(result.approval.fact_id).toBe("f_ask_1");
        expect(result.approval.owner_id).toBe(baseContext.owner_id);
      }
    });

    it("runRulesEngine invokes approval creator on 'ask' action", async () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_ask_2",
          text: "Home address is 42 Market Street",
          share_rule: "ask",
        },
      ];

      let createdApprovalId = "";
      const customCreator = async (data: { fact_id: string }) => {
        createdApprovalId = `app_${data.fact_id}`;
        return createdApprovalId;
      };

      const result = await runRulesEngine(
        facts,
        "What is the home address?",
        baseContext,
        customCreator,
      );

      expect(result.action).toBe("ask");
      if (result.action === "ask") {
        expect(result.approval.id).toBe("app_f_ask_2");
      }
    });
  });

  describe("THE LOCKED BOX: never-fact exclusion", () => {
    it("strictly excludes never-share facts and returns no_answer when only never facts match", () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_never_1",
          text: "Secret personal investment portfolio is ten million dollars",
          share_rule: "never",
        },
      ];

      const result = evaluateRules(facts, "How much is the investment portfolio?", baseContext);
      expect(result.action).toBe("no_answer");
    });

    it("never includes never-share fact IDs in answer or ask outcomes", () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_share_1",
          text: "Public office address is 100 Main Street",
          share_rule: "share",
        },
        {
          id: "f_never_1",
          text: "Secret home address is 99 Confidential Way",
          share_rule: "never",
        },
      ];

      const result = evaluateRules(facts, "Where is the office address?", baseContext);
      expect(result.action).toBe("answer");
      if (result.action === "answer") {
        expect(result.fact_ids).toEqual(["f_share_1"]);
        expect(result.fact_ids).not.toContain("f_never_1");
      }
    });
  });

  describe("Blocked fact forces no_answer even if share_rule is 'share'", () => {
    it("forces no_answer when matching fact is in blocked_fact_ids", () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_blocked_1",
          text: "Personal mobile phone number is 555-0199",
          share_rule: "share", // Rule says share, but owner previously tapped Never
        },
      ];

      const contextWithBlock: RulesEngineContext = {
        ...baseContext,
        blocked_fact_ids: ["f_blocked_1"],
      };

      const result = evaluateRules(facts, "What is the phone number?", contextWithBlock);
      expect(result.action).toBe("no_answer");
    });
  });

  describe("No-match is no_answer", () => {
    it("returns no_answer when no facts match the question", () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_1",
          text: "Favorite food is Italian pasta",
          share_rule: "share",
        },
      ];

      const result = evaluateRules(facts, "Where did you go to university?", baseContext);
      expect(result.action).toBe("no_answer");
    });
  });

  describe("Precedence and invalid facts", () => {
    it("ignores soft-deleted facts with invalid_at set", () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_old",
          text: "Old flight time was 9am",
          share_rule: "share",
          invalid_at: "2026-01-01T00:00:00Z",
        },
      ];

      const result = evaluateRules(facts, "What is the flight time?", baseContext);
      expect(result.action).toBe("no_answer");
    });

    it("ask takes precedence over share when both match", () => {
      const facts: RulesEngineCandidate[] = [
        {
          id: "f_share",
          text: "Attending summit in Berlin next week",
          share_rule: "share",
        },
        {
          id: "f_ask",
          text: "Berlin hotel room number is 402",
          share_rule: "ask",
        },
      ];

      const result = evaluateRules(facts, "What is the Berlin hotel and summit plan?", baseContext);
      expect(result.action).toBe("ask");
      if (result.action === "ask") {
        expect(result.approval.fact_id).toBe("f_ask");
      }
    });
  });
});
