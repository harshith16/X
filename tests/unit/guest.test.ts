import { describe, it, expect, beforeEach } from "vitest";
import {
  hashGuestToken,
  generateGuestToken,
  computeInviteStatus,
  createGuestInvite,
  revokeGuestInvite,
  getInviteByToken,
  acceptGuestInvite,
  getGuestConversationContext,
  isGuestInviteRevoked,
  GuestError,
} from "@/server/guests/service";
import { FREE_GUEST_LIMIT, type GuestInviteRecord } from "@/types/guest";
import { record, getRecordedEvents, AnalyticsValidationError } from "@/server/analytics/record";
import { RelayStore } from "@/server/relay/store";

describe("Guest links unit tests", () => {
  beforeEach(() => {
    RelayStore.clearMemory();
  });

  describe("Token hashing & security", () => {
    it("never stores raw token as token_hash and uses deterministic SHA-256", () => {
      const rawToken = generateGuestToken();
      const hash1 = hashGuestToken(rawToken);
      const hash2 = hashGuestToken(rawToken);

      // Raw token must never match hash
      expect(rawToken).not.toBe(hash1);
      // Hash is 64 hex characters (SHA-256)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      // Deterministic
      expect(hash1).toBe(hash2);
      // Starts with gt_ prefix for raw token
      expect(rawToken.startsWith("gt_")).toBe(true);
    });
  });

  describe("Expiry math & status computation", () => {
    it("expires exactly 7 days after creation", () => {
      const now = Date.now();
      const invite: GuestInviteRecord = {
        id: "inv_test_1",
        token_hash: "hash123",
        owner_id: "owner_1",
        agent_id: "agent_1",
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
        accepted_at: null,
        revoked_at: null,
        accepted_user_id: null,
      };

      const diffMs = new Date(invite.expires_at).getTime() - new Date(invite.created_at).getTime();
      expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(computeInviteStatus(invite)).toBe("pending");
    });

    it("computes correct status across lifecycles", () => {
      const now = Date.now();
      const baseInvite: GuestInviteRecord = {
        id: "inv_test_2",
        token_hash: "hash456",
        owner_id: "owner_1",
        agent_id: "agent_1",
        created_at: new Date(now - 1000).toISOString(),
        expires_at: new Date(now + 5000).toISOString(),
        accepted_at: null,
        revoked_at: null,
        accepted_user_id: null,
      };

      // 1. Pending
      expect(computeInviteStatus(baseInvite)).toBe("pending");

      // 2. Active
      const activeInvite = { ...baseInvite, accepted_at: new Date().toISOString() };
      expect(computeInviteStatus(activeInvite)).toBe("active");

      // 3. Expired
      const expiredInvite = {
        ...baseInvite,
        expires_at: new Date(now - 1000).toISOString(),
      };
      expect(computeInviteStatus(expiredInvite)).toBe("expired");

      // 4. Revoked beats active/expired
      const revokedInvite = {
        ...activeInvite,
        revoked_at: new Date().toISOString(),
      };
      expect(computeInviteStatus(revokedInvite)).toBe("revoked");
    });
  });

  describe("Cap enforcement: max 3 active guests free", () => {
    it("enforces FREE_GUEST_LIMIT = 3 constant", () => {
      expect(FREE_GUEST_LIMIT).toBe(3);
    });

    it("rejects 4th active invite with 409 and plain human message", async () => {
      const ownerId = crypto.randomUUID();
      const reqId = "req_cap_test";

      // Create 3 invites
      const res1 = await createGuestInvite(ownerId, reqId, "http://localhost:3000");
      const res2 = await createGuestInvite(ownerId, reqId, "http://localhost:3000");
      const res3 = await createGuestInvite(ownerId, reqId, "http://localhost:3000");

      expect(res1.invite).toBeDefined();
      expect(res2.invite).toBeDefined();
      expect(res3.invite).toBeDefined();

      // 4th invite must throw 409
      let errorThrown: any = null;
      try {
        await createGuestInvite(ownerId, reqId, "http://localhost:3000");
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).toBeInstanceOf(GuestError);
      expect(errorThrown.statusCode).toBe(409);
      expect(errorThrown.code).toBe("FREE_GUEST_LIMIT_REACHED");
      expect(errorThrown.message).toContain("You have 3 active guests — the free limit. More guests will be a paid tier.");

      // Revoke one invite
      await revokeGuestInvite(ownerId, res1.invite.id, reqId);

      // Now 4th (now 3rd active) should succeed!
      const res4 = await createGuestInvite(ownerId, reqId, "http://localhost:3000");
      expect(res4.invite).toBeDefined();
    });
  });

  describe("Revoke cascade", () => {
    it("marks invite revoked, cascades to helper and denials", async () => {
      const ownerId = crypto.randomUUID();
      const reqId = "req_rev_test";

      const { invite, rawToken } = await createGuestInvite(ownerId, reqId, "http://localhost:3000");
      expect(await isGuestInviteRevoked(invite.id)).toBe(false);

      // Accept invite
      const guestUserId = crypto.randomUUID();
      const accepted = await acceptGuestInvite(rawToken, guestUserId, reqId);
      expect(accepted.conversationId).toBeDefined();

      // Revoke invite
      const revokeRes = await revokeGuestInvite(ownerId, invite.id, reqId);
      expect(revokeRes.ok).toBe(true);

      // Verify revoked
      expect(await isGuestInviteRevoked(invite.id)).toBe(true);

      // Fetch by token now returns status 'revoked'
      const lookup = await getInviteByToken(rawToken);
      expect(lookup.status).toBe("revoked");
    });
  });

  describe("Server isolation: cross-leak prevention", () => {
    it("guest can only access their own conversation and not other guests or owners", async () => {
      const ownerId = crypto.randomUUID();
      const reqId = "req_iso_test";

      // Create two invites for two different guests
      const invA = await createGuestInvite(ownerId, reqId, "http://localhost:3000");
      const invB = await createGuestInvite(ownerId, reqId, "http://localhost:3000");

      const guestUserA = crypto.randomUUID();
      const guestUserB = crypto.randomUUID();

      const convA = await acceptGuestInvite(invA.rawToken, guestUserA, reqId);
      const convB = await acceptGuestInvite(invB.rawToken, guestUserB, reqId);

      // Guest A can access Conv A
      const ctxA = await getGuestConversationContext(convA.conversationId, guestUserA);
      expect(ctxA).not.toBeNull();
      expect(ctxA?.conversationId).toBe(convA.conversationId);

      // Guest A CANNOT access Conv B -> returns null (403)
      const crossAonB = await getGuestConversationContext(convB.conversationId, guestUserA);
      expect(crossAonB).toBeNull();

      // Guest B CANNOT access Conv A -> returns null (403)
      const crossBonA = await getGuestConversationContext(convA.conversationId, guestUserB);
      expect(crossBonA).toBeNull();

      // Random user cannot access either
      const randomUser = crypto.randomUUID();
      expect(await getGuestConversationContext(convA.conversationId, randomUser)).toBeNull();
      expect(await getGuestConversationContext(convB.conversationId, randomUser)).toBeNull();
    });
  });

  describe("Metadata-only analytics (8e throwing denylist)", () => {
    it("throws AnalyticsValidationError when message text, body, names, or emails are passed", async () => {
      const reqId = "req_analytics_test";
      await expect(
        record(
          "guest_invite_accepted",
          {
            invite_id: "inv_123",
            text: "secret message text",
          },
          reqId,
        ),
      ).rejects.toThrow(AnalyticsValidationError);

      await expect(
        record(
          "guest_invite_accepted",
          {
            invite_id: "inv_123",
            body: "secret body",
          },
          reqId,
        ),
      ).rejects.toThrow(AnalyticsValidationError);

      await expect(
        record(
          "guest_invite_accepted",
          {
            invite_id: "inv_123",
            email: "user@example.com",
          },
          reqId,
        ),
      ).rejects.toThrow(AnalyticsValidationError);

      await expect(
        record(
          "guest_invite_accepted",
          {
            invite_id: "inv_123",
            name: "John Doe",
          },
          reqId,
        ),
      ).rejects.toThrow(AnalyticsValidationError);
    });

    it("records valid metadata properties with IDs, timestamps, and outcome classes ONLY", async () => {
      const reqId = "req_analytics_test";
      const testInviteId = "inv_specific_test_" + Math.random().toString(36).slice(2, 8);
      await record(
        "guest_invite_accepted",
        {
          invite_id: testInviteId,
          owner_id: "owner_123",
          guest_user_id: "user_456",
          conversation_id: "conv_789",
        },
        reqId,
      );

      const events = await getRecordedEvents();
      const match = events.find((e) => e.properties.invite_id === testInviteId);
      expect(match).toBeDefined();
      expect(match?.properties.invite_id).toBe(testInviteId);
      expect(match?.properties.owner_id).toBe("owner_123");
      expect(match?.properties.guest_user_id).toBe("user_456");
      expect(match?.properties.conversation_id).toBe("conv_789");

      // Verify zero PII / content
      expect(match?.properties.text).toBeUndefined();
      expect(match?.properties.body).toBeUndefined();
      expect(match?.properties.name).toBeUndefined();
      expect(match?.properties.email).toBeUndefined();
    });
  });
});
