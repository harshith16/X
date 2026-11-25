import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  screenOutgoingMessage,
  matchesGuardText,
  normalizeOutgoingText,
  cleanPunctuation,
} from "@/server/rules/engine";
import {
  GUARD_CATEGORIES_CATALOGUE,
  getOwnerCategoryModes,
  setOwnerCategoryMode,
  getDefaultCategoryMode,
} from "@/server/rules/categories";
import {
  detectSpecifics,
  detectSecrets,
  detectHomeAddress,
  detectPhoneNumber,
  detectPersonalEmail,
  detectLiveLocation,
  detectMoneyFigures,
  detectHealthSpecifics,
  detectFamilySpecifics,
  isValidLuhn,
} from "@/server/rules/detector";
import { resolveApproval } from "@/server/approvals/service";
import { RelayError } from "@/server/relay/service";
import { RelayStore } from "@/server/relay/store";
import * as dbClients from "@/server/db/clients";

describe("Screening in the Send Path (Pure Deterministic Rules Engine)", () => {
  const testOwnerId = "test_owner_screen_1";
  const testAgentId = "test_agent_screen_1";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Text Normalization and Variant Matching", () => {
    it("normalizes whitespace, tabs, and case", () => {
      const input = "  Secret \t\n  Passcode  123   ";
      expect(normalizeOutgoingText(input)).toBe("secret passcode 123");
    });

    it("cleans punctuation for flexible matching", () => {
      const input = "secret-passcode! #123?";
      expect(cleanPunctuation(input)).toBe("secret passcode 123");
    });

    it("matches guard text across case variants", () => {
      expect(matchesGuardText("My Secret Key", "Here is my secret key.")).toBe(true);
      expect(matchesGuardText("my secret key", "HERE IS MY SECRET KEY")).toBe(true);
    });

    it("matches guard text across whitespace and newline variants", () => {
      expect(matchesGuardText("private address", "My   private  \n\t address is here")).toBe(true);
    });

    it("matches guard text across punctuation variants", () => {
      expect(matchesGuardText("super-secret", "It is super secret")).toBe(true);
      expect(matchesGuardText("super secret", "Don't share: super-secret!")).toBe(true);
    });
  });

  describe("Never Guard Entries — Block Behavior", () => {
    it("blocks outgoing messages matching a never guard entry", async () => {
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text: "The secret pin is 998877",
        overrideFacts: [
          {
            id: "fact_never_1",
            text: "secret pin",
            share_rule: "never",
          },
        ],
        overrideCategories: [],
      });

      expect(result.action).toBe("block");
      expect(result.matchedFactId).toBe("fact_never_1");
    });

    it("blocks case and whitespace variations of never guard entries", async () => {
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text: "HERE IS THE   SECRET \n PIN   FOR ACCESS",
        overrideFacts: [
          {
            id: "fact_never_2",
            text: "secret pin",
            share_rule: "never",
          },
        ],
        overrideCategories: [],
      });

      expect(result.action).toBe("block");
    });

    it("the error code is 'blocked_by_rules' and never contains the guard text", async () => {
      const secretPhrase = "classified_quantum_project_alpha_9";

      // 1. Screen detects block
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text: `Sharing details about ${secretPhrase}`,
        overrideFacts: [
          {
            id: "fact_secret_1",
            text: secretPhrase,
            share_rule: "never",
          },
        ],
      });
      expect(result.action).toBe("block");

      // 2. The relay error constructed for the agent
      const relayErr = new RelayError("blocked_by_rules", "Message blocked by owner guardrails.", 403);
      expect(relayErr.code).toBe("blocked_by_rules");
      expect(relayErr.statusCode).toBe(403);
      // Security guarantee: never reveal which entry matched or the sensitive text
      expect(relayErr.message).not.toContain(secretPhrase);
      expect(relayErr.message).not.toContain("fact_secret_1");
      expect(relayErr.message).toBe("Message blocked by owner guardrails.");
    });
  });

  describe("Ask Guard Entries — Hold for Approval", () => {
    it("holds outgoing message draft when matching an ask guard entry", async () => {
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text: "The travel dates are next Monday to Friday",
        overrideFacts: [
          {
            id: "fact_ask_1",
            text: "travel dates",
            share_rule: "ask",
          },
        ],
        overrideCategories: [],
      });

      expect(result.action).toBe("hold");
      expect(result.approvalId).toBeDefined();
      expect(result.matchedFactId).toBe("fact_ask_1");
    });
  });

  describe("Specifics Detector: Positive Detection per Key", () => {
    it("secrets: detects Luhn-valid credit card number", () => {
      expect(isValidLuhn("4000000000000002")).toBe(true);
      expect(detectSecrets("Pay with card 4000-0000-0000-0002")).toBe(true);
    });

    it("secrets: detects passwords, OTPs, PINs, API keys, and bank details", () => {
      expect(detectSecrets("my password is CorrectHorseBatteryStaple")).toBe(true);
      expect(detectSecrets("your OTP code is 492810")).toBe(true);
      expect(detectSecrets("master pin: 1234")).toBe(true);
      expect(detectSecrets("sk-ant-api03-abcdef12345678901234567890")).toBe(true);
      expect(detectSecrets("IFSC code is HDFC0001234")).toBe(true);
    });

    it("home_address: detects exact street addresses and address declarations", () => {
      expect(detectHomeAddress("I live at 742 Evergreen Terrace, Springfield")).toBe(false); // Terrace not in suffix list
      expect(detectHomeAddress("My house is 123 Elm Street, Apt 4B")).toBe(true);
      expect(detectHomeAddress("my home address is 500 Park Avenue")).toBe(true);
      expect(detectHomeAddress("residence address: 42 Wallaby Way")).toBe(true);
    });

    it("phone_number: detects standard phone formats", () => {
      expect(detectPhoneNumber("Call me at +1 (555) 234-5678")).toBe(true);
      expect(detectPhoneNumber("My mobile number is 9876543210")).toBe(true);
      expect(detectPhoneNumber("reach me at 555-432-1098")).toBe(true);
    });

    it("personal_email: detects email addresses", () => {
      expect(detectPersonalEmail("Send it to alex.smith@example.com")).toBe(true);
      expect(detectPersonalEmail("reach out at owner@company.org")).toBe(true);
    });

    it("live_location: detects coordinates, map links, and real-time location phrasing", () => {
      expect(detectLiveLocation("Meeting here: 37.7749, -122.4194")).toBe(true);
      expect(detectLiveLocation("See my pin: https://maps.google.com/?q=loc:37.7")).toBe(true);
      expect(detectLiveLocation("I am at the Starbucks on 5th right now")).toBe(true);
      expect(detectLiveLocation("Here is my live location")).toBe(true);
    });

    it("money_figures: detects salary, balance, debt figures with context", () => {
      expect(detectMoneyFigures("my salary is 2400000")).toBe(true);
      expect(detectMoneyFigures("account balance is $15000")).toBe(true);
      expect(detectMoneyFigures("total debt of 45000 USD")).toBe(true);
      expect(detectMoneyFigures("annual income: 120k")).toBe(true);
    });

    it("health_specifics: detects named conditions, prescription medicines, dosages", () => {
      expect(detectHealthSpecifics("diagnosed with type 2 diabetes")).toBe(true);
      expect(detectHealthSpecifics("taking 500mg of metformin daily")).toBe(true);
      expect(detectHealthSpecifics("prescription for amoxicillin")).toBe(true);
    });

    it("family_specifics: detects kid school enrollment and private family identifiers", () => {
      expect(detectFamilySpecifics("his daughter attends St Jude Academy")).toBe(true);
      expect(detectFamilySpecifics("our kid's daycare is Little Angels")).toBe(true);
      expect(detectFamilySpecifics("mother's maiden name is Vance")).toBe(true);
    });
  });

  describe("Benign Negatives — Default Mode Deliveries", () => {
    // These 5 exact benign negatives MUST pass with default modes:
    // 1. "he has a doctor's appointment on Friday"
    // 2. "his daughter's school play is Saturday"
    // 3. "lunch was 400, I paid"
    // 4. "the meeting is at 5"
    // 5. "he is travelling for work next week"

    it("1. 'he has a doctor's appointment on Friday' delivers", async () => {
      const text = "he has a doctor's appointment on Friday";
      expect(detectSpecifics(text)).toEqual([]);
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text,
        overrideFacts: [],
      });
      expect(result.action).toBe("deliver");
    });

    it("2. 'his daughter's school play is Saturday' delivers", async () => {
      const text = "his daughter's school play is Saturday";
      expect(detectSpecifics(text)).toEqual([]);
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text,
        overrideFacts: [],
      });
      expect(result.action).toBe("deliver");
    });

    it("3. 'lunch was 400, I paid' delivers", async () => {
      const text = "lunch was 400, I paid";
      expect(detectSpecifics(text)).toEqual([]);
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text,
        overrideFacts: [],
      });
      expect(result.action).toBe("deliver");
    });

    it("4. 'the meeting is at 5' delivers", async () => {
      const text = "the meeting is at 5";
      expect(detectSpecifics(text)).toEqual([]);
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text,
        overrideFacts: [],
      });
      expect(result.action).toBe("deliver");
    });

    it("5. 'he is travelling for work next week' delivers", async () => {
      const text = "he is travelling for work next week";
      expect(detectSpecifics(text)).toEqual([]);
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text,
        overrideFacts: [],
      });
      expect(result.action).toBe("deliver");
    });

    it("Combined benign negative text delivers cleanly under default modes", async () => {
      const text = "he has a doctor's appointment on Friday and his daughter's school play is Saturday";
      expect(detectSpecifics(text)).toEqual([]);
      const result = await screenOutgoingMessage({
        ownerId: testOwnerId,
        agentId: testAgentId,
        text,
        overrideFacts: [],
      });
      expect(result.action).toBe("deliver");
    });
  });

  describe("Category Defaults & Catalogue", () => {
    it("has 8 specifics categories with exact specified defaults", () => {
      const categories = Object.keys(GUARD_CATEGORIES_CATALOGUE);
      expect(categories).toHaveLength(8);

      expect(getDefaultCategoryMode("secrets")).toBe("never");
      expect(getDefaultCategoryMode("home_address")).toBe("ask");
      expect(getDefaultCategoryMode("phone_number")).toBe("ask");
      expect(getDefaultCategoryMode("personal_email")).toBe("ask");
      expect(getDefaultCategoryMode("live_location")).toBe("never");
      expect(getDefaultCategoryMode("money_figures")).toBe("ask");
      expect(getDefaultCategoryMode("health_specifics")).toBe("ask");
      expect(getDefaultCategoryMode("family_specifics")).toBe("open");
    });

    it("rejects mode 'open' for secrets category", async () => {
      const ownerId = "test_owner_secrets_open";
      await expect(setOwnerCategoryMode(ownerId, "secrets", "open" as any)).rejects.toThrow();
    });

    it("returns default modes for a new owner", async () => {
      const ownerId = "new_owner_" + Date.now();
      const modes = await getOwnerCategoryModes(ownerId);
      expect(modes).toHaveLength(8);

      const secretsMode = modes.find((c) => c.category === "secrets");
      const phoneMode = modes.find((c) => c.category === "phone_number");
      const locationMode = modes.find((c) => c.category === "live_location");
      const familyMode = modes.find((c) => c.category === "family_specifics");

      expect(secretsMode?.mode).toBe("never");
      expect(phoneMode?.mode).toBe("ask");
      expect(locationMode?.mode).toBe("never");
      expect(familyMode?.mode).toBe("open");
    });

    it("respects category toggle updates and blocks when mode is set to never", async () => {
      const ownerId = "toggle_owner_" + Date.now();
      // Initially money_figures is 'ask'
      expect(getDefaultCategoryMode("money_figures")).toBe("ask");

      // Update money_figures to 'never'
      await setOwnerCategoryMode(ownerId, "money_figures", "never");
      const modes = await getOwnerCategoryModes(ownerId);
      const moneyMode = modes.find((c) => c.category === "money_figures");
      expect(moneyMode?.mode).toBe("never");

      // Now screening a salary figure triggers a BLOCK
      const result = await screenOutgoingMessage({
        ownerId,
        agentId: "agent_toggle_1",
        text: "my salary is 2400000",
        overrideFacts: [],
      });

      expect(result.action).toBe("block");
      expect(result.category).toBe("money_figures");
    });

    it("holds for approval when category mode is ask", async () => {
      const ownerId = "ask_owner_" + Date.now();
      // phone_number defaults to 'ask'
      expect(getDefaultCategoryMode("phone_number")).toBe("ask");

      const result = await screenOutgoingMessage({
        ownerId,
        agentId: "agent_ask_1",
        text: "Please call me at +1 555-123-4567",
        overrideFacts: [],
      });

      expect(result.action).toBe("hold");
      expect(result.category).toBe("phone_number");
      expect(result.approvalId).toBeDefined();
    });
  });

  describe("Approval Resolution Re-Screening", () => {
    it("re-screens on delivery when owner shares: if new never rule matches, marks blocked and does not deliver", async () => {
      const ownerId = "owner_rescreen_unit";
      const approvalId = "00000000-0000-0000-0000-000000000001";
      const draftWithSecret = "Here is the master pin code 998877";

      // Mock database calls
      const mockApproval = {
        id: approvalId,
        owner_id: ownerId,
        agent_id: "agent_123",
        conversation_id: "00000000-0000-0000-0000-000000000002",
        fact_id: "fact_ask_1",
        question: draftWithSecret,
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const insertSpy = vi.spyOn(RelayStore, "insertMessage").mockResolvedValue({
        id: "msg_1",
        conversation_id: "conv_1",
        sender_agent_id: "agent_123",
        sender_owner_id: null,
        body: draftWithSecret,
        idempotency_key: "idemp_1",
        status: "delivered",
        seq: 1,
        created_at: new Date().toISOString(),
      });

      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === "approvals") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: mockApproval, error: null }),
                  })),
                })),
              })),
              update: vi.fn((updateData: any) => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: { ...mockApproval, ...updateData },
                      error: null,
                    }),
                  })),
                })),
              })),
            };
          }
          if (table === "facts") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    in: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: "fact_never_new",
                          text: "master pin",
                          share_rule: "never",
                          invalid_at: null,
                        },
                      ],
                      error: null,
                    }),
                  })),
                })),
              })),
            };
          }
          if (table === "blocks") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === "guard_categories") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            };
          }
          return {
            select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [] }) }),
          };
        }),
      } as any;

      vi.spyOn(dbClients, "getServiceClient").mockReturnValue(mockDb);

      const result = await resolveApproval(ownerId, approvalId, "share", "req_rescreen_unit");

      // Verify approval was marked blocked
      expect(result.ok).toBe(true);
      expect(result.approval.status).toBe("blocked");

      // Crucial verification: draft was NOT delivered into the conversation
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it("re-screens on delivery when owner shares: if clean, delivers the draft into the conversation", async () => {
      const ownerId = "owner_rescreen_clean";
      const approvalId = "00000000-0000-0000-0000-000000000003";
      const cleanDraft = "I would be happy to meet at the coffee shop at 2pm.";

      const mockApproval = {
        id: approvalId,
        owner_id: ownerId,
        agent_id: "agent_123",
        conversation_id: "00000000-0000-0000-0000-000000000002",
        fact_id: "fact_ask_2",
        question: cleanDraft,
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const insertSpy = vi.spyOn(RelayStore, "insertMessage").mockResolvedValue({
        id: "msg_delivered_2",
        conversation_id: "00000000-0000-0000-0000-000000000002",
        sender_agent_id: "agent_123",
        sender_owner_id: null,
        body: cleanDraft,
        idempotency_key: "idemp_2",
        status: "delivered",
        seq: 1,
        created_at: new Date().toISOString(),
      });

      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === "approvals") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: mockApproval, error: null }),
                  })),
                })),
              })),
              update: vi.fn((updateData: any) => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: { ...mockApproval, ...updateData },
                      error: null,
                    }),
                  })),
                })),
              })),
            };
          }
          if (table === "facts") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    in: vi.fn().mockResolvedValue({
                      data: [],
                      error: null,
                    }),
                  })),
                })),
              })),
            };
          }
          if (table === "blocks") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            };
          }
          if (table === "guard_categories") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            };
          }
          return {
            select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [] }) }),
          };
        }),
      } as any;

      vi.spyOn(dbClients, "getServiceClient").mockReturnValue(mockDb);

      const result = await resolveApproval(ownerId, approvalId, "share", "req_rescreen_clean");

      expect(result.ok).toBe(true);
      expect(result.approval.status).toBe("shared");

      // Verify draft was delivered through RelayStore.insertMessage
      expect(insertSpy).toHaveBeenCalledWith(
        mockApproval.conversation_id,
        mockApproval.agent_id,
        cleanDraft,
        `approval_resolve_${approvalId}`,
      );
    });
  });
});
