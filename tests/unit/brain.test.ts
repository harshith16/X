import { describe, expect, it, beforeEach } from "vitest";
import { thinkAgent } from "@/server/brain/think";
import { recordedLlmPayloads, clearRecordedLlmPayloads } from "@/server/brain/llm";
import { AgentRecord } from "@/types/agent";
import { RulesEngineCandidate } from "@/server/rules/engine";

describe("Brain & Locked Box Security Verification", () => {
  const dummyAgent: AgentRecord = {
    id: "agent_test_1",
    owner_id: "owner_test_1",
    handle: "testagent",
    display_name: "@testagent",
    status: "active",
    credential_hash: "hash123",
    last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    process.env.BRAIN_FAKE_LLM = "true";
    clearRecordedLlmPayloads();
  });

  it("proves fake LLM mode records context payload without network calls", async () => {
    const facts: RulesEngineCandidate[] = [
      {
        id: "f_share_1",
        text: "Working from the Bangalore office this week",
        share_rule: "share",
      },
    ];

    const res = await thinkAgent(
      dummyAgent,
      "conv_123",
      "Where are they working from this week?",
      "req_1",
      { facts },
    );

    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("reply");
    expect(res.reply).toContain("Bangalore office");
    expect(recordedLlmPayloads.length).toBe(1);
    expect(recordedLlmPayloads[0]!.approvedFacts).toEqual([
      "Working from the Bangalore office this week",
    ]);
  });

  it("LOCKED BOX PROOF: planted never-fact text appears in ZERO recorded fake-LLM payloads and ZERO think responses", async () => {
    const PLANTED_SECRET = "SUPER_SECRET_SECURITY_PASSCODE_77194";

    const facts: RulesEngineCandidate[] = [
      {
        id: "f_never_secret",
        text: `Owner master vault pin is ${PLANTED_SECRET}`,
        share_rule: "never",
      },
    ];

    const res = await thinkAgent(
      dummyAgent,
      "conv_locked_box",
      "What is the master vault pin passcode?",
      "req_lb_1",
      { facts },
    );

    // 1. Outcome must be no_answer deflection
    expect(res.outcome).toBe("no_answer");

    // 2. Secret text must appear in ZERO think responses
    expect(res.reply).toBeDefined();
    expect(res.reply).not.toContain(PLANTED_SECRET);
    expect(res.reply).not.toContain("77194");
    expect(res.reply).not.toContain("vault pin");

    // 3. Secret text must appear in ZERO recorded LLM payloads
    for (const payload of recordedLlmPayloads) {
      expect(payload.context).not.toContain(PLANTED_SECRET);
      expect(payload.question).not.toContain(PLANTED_SECRET);
      for (const fact of payload.approvedFacts) {
        expect(fact).not.toContain(PLANTED_SECRET);
      }
    }

    // In fact, because outcome was no_answer, zero LLM calls happened
    expect(recordedLlmPayloads.length).toBe(0);
  });

  it("LOCKED BOX PROOF: never-fact is strictly excluded when mixed with a share fact", async () => {
    const PLANTED_SECRET = "CLASSIFIED_BANK_ACCOUNT_ROUTING_994411";

    const facts: RulesEngineCandidate[] = [
      {
        id: "f_share_pub",
        text: "Public business email is contact@acme.test",
        share_rule: "share",
      },
      {
        id: "f_never_priv",
        text: `Private routing number is ${PLANTED_SECRET}`,
        share_rule: "never",
      },
    ];

    const res = await thinkAgent(
      dummyAgent,
      "conv_mixed",
      "What is the public business email and routing number?",
      "req_lb_2",
      { facts },
    );

    // Share fact answered
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("reply");

    // Planted never secret must be in ZERO think responses
    expect(res.reply).not.toContain(PLANTED_SECRET);
    expect(res.reply).not.toContain("994411");

    // Planted never secret must be in ZERO recorded LLM payloads
    expect(recordedLlmPayloads.length).toBe(1);
    const recorded = recordedLlmPayloads[0]!;
    expect(recorded.context).not.toContain(PLANTED_SECRET);
    expect(recorded.context).toContain("contact@acme.test");
    for (const fact of recorded.approvedFacts) {
      expect(fact).not.toContain(PLANTED_SECRET);
    }
  });

  it("Deflection microcopy: human, diplomatic redirect with ZERO robotic phrasing", async () => {
    const facts: RulesEngineCandidate[] = [
      {
        id: "f_ask_trip",
        text: "Goa flight departs at 6:30am",
        share_rule: "ask",
      },
    ];

    let createdApprovalId = "";
    const res = await thinkAgent(
      dummyAgent,
      "conv_ask",
      "What time is the Goa flight departure?",
      "req_deflect",
      {
        facts,
        approvalCreator: async () => {
          createdApprovalId = "app_12345";
          return createdApprovalId;
        },
      },
    );

    expect(res.outcome).toBe("deflect");
    expect(res.approval_id).toBe("app_12345");
    expect(res.reply).toBeDefined();

    const reply = res.reply!.toLowerCase();

    // Robotic jargon banned per docs/DESIGN.md §5 and prompt
    const BANNED_ROBOTIC_WORDS = [
      "permission",
      "disclose",
      "cannot share",
      "not authorized",
      "access denied",
      "policy blocked",
      "as an ai",
      "classified",
      "forbidden",
    ];

    for (const banned of BANNED_ROBOTIC_WORDS) {
      expect(reply).not.toContain(banned);
    }

    // Proves it changes the topic diplomatically
    expect(reply).toMatch(/how|what|lately|doing|going/);
  });
});
