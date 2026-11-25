import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import {
  requestContactByHandle,
  getContactsForOwner,
  respondToContactRequest,
  removeContact,
  createContactInvite,
  resolveContactInvite,
  acceptContactInvite,
  areOwnersAcceptedContacts,
  memoryContacts,
  memoryContactInvites,
  ContactError,
} from "@/server/contacts/service";
import { RelayStore } from "@/server/relay/store";

describe("Contacts & Invites Unit Tests", () => {
  const ownerA = "owner_a_" + crypto.randomUUID();
  const ownerB = "owner_b_" + crypto.randomUUID();
  const ownerC = "owner_c_" + crypto.randomUUID();

  const agentA = {
    id: "agent_a_" + crypto.randomUUID(),
    owner_id: ownerA,
    handle: "alice_agent",
    display_name: "Alice Agent",
    status: "active",
    last_seen_at: new Date().toISOString(),
  };

  const agentB = {
    id: "agent_b_" + crypto.randomUUID(),
    owner_id: ownerB,
    handle: "bob_agent",
    display_name: "Bob Agent",
    status: "active",
    last_seen_at: new Date().toISOString(),
  };

  const agentC = {
    id: "agent_c_" + crypto.randomUUID(),
    owner_id: ownerC,
    handle: "charlie_agent",
    display_name: "Charlie Agent",
    status: "active",
    last_seen_at: new Date().toISOString(),
  };

  beforeEach(() => {
    memoryContacts.clear();
    memoryContactInvites.clear();

    const globalAgents = ((globalThis as any).__memoryAgents ??= new Map<string, any>());
    globalAgents.set(agentA.id, agentA);
    globalAgents.set(agentB.id, agentB);
    globalAgents.set(agentC.id, agentC);
  });

  describe("Contact Request State Machine & Validation", () => {
    it("creates a pending contact request and verifies validation rules", async () => {
      // 1. Unknown handle -> 404
      await expect(
        requestContactByHandle(ownerA, "non_existent_handle", "req_test"),
      ).rejects.toThrowError(ContactError);

      try {
        await requestContactByHandle(ownerA, "non_existent_handle", "req_test");
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("AGENT_NOT_FOUND");
      }

      // 2. Add self -> 400
      await expect(
        requestContactByHandle(ownerA, "alice_agent", "req_test"),
      ).rejects.toThrowError(ContactError);

      try {
        await requestContactByHandle(ownerA, "alice_agent", "req_test");
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("CANNOT_ADD_SELF");
      }

      // 3. Valid request: A requests B
      const contact = await requestContactByHandle(ownerA, "bob_agent", "req_test");
      expect(contact.state).toBe("pending");
      expect(contact.owner_id).toBe(ownerA);
      expect(contact.contact_owner_id).toBe(ownerB);

      // 4. Duplicate request while pending -> 409
      await expect(
        requestContactByHandle(ownerA, "bob_agent", "req_test"),
      ).rejects.toThrowError(ContactError);

      try {
        await requestContactByHandle(ownerA, "bob_agent", "req_test");
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe("REQUEST_ALREADY_PENDING");
      }

      // 5. Check incoming/outgoing visibility
      const contactsA = await getContactsForOwner(ownerA, "req_test");
      expect(contactsA.contacts.length).toBe(0);
      expect(contactsA.outgoing.length).toBe(1);
      expect(contactsA.outgoing[0].handle).toBe("bob_agent");
      expect(contactsA.incoming.length).toBe(0);

      const contactsB = await getContactsForOwner(ownerB, "req_test");
      expect(contactsB.contacts.length).toBe(0);
      expect(contactsB.incoming.length).toBe(1);
      expect(contactsB.incoming[0].handle).toBe("alice_agent");
      expect(contactsB.outgoing.length).toBe(0);
    });

    it("enforces recipient-only response and writes reciprocal accepted rows on accept", async () => {
      const contact = await requestContactByHandle(ownerA, "bob_agent", "req_test");

      // Third party (ownerC) trying to accept -> 403 FORBIDDEN
      await expect(
        respondToContactRequest(contact.id, ownerC, "accept", "req_test"),
      ).rejects.toThrowError(ContactError);

      // Requester (ownerA) trying to accept their own request -> 403 FORBIDDEN
      await expect(
        respondToContactRequest(contact.id, ownerA, "accept", "req_test"),
      ).rejects.toThrowError(ContactError);

      // Recipient (ownerB) accepts -> success
      const result = await respondToContactRequest(contact.id, ownerB, "accept", "req_test");
      expect(result.ok).toBe(true);
      expect(result.state).toBe("accepted");

      // Verify symmetry: both A and B have each other in contacts
      const contactsA = await getContactsForOwner(ownerA, "req_test");
      expect(contactsA.contacts.length).toBe(1);
      expect(contactsA.contacts[0].handle).toBe("bob_agent");
      expect(contactsA.outgoing.length).toBe(0);
      expect(contactsA.incoming.length).toBe(0);

      const contactsB = await getContactsForOwner(ownerB, "req_test");
      expect(contactsB.contacts.length).toBe(1);
      expect(contactsB.contacts[0].handle).toBe("alice_agent");
      expect(contactsB.outgoing.length).toBe(0);
      expect(contactsB.incoming.length).toBe(0);

      // Verify areOwnersAcceptedContacts helper
      expect(await areOwnersAcceptedContacts(ownerA, ownerB)).toBe(true);
      expect(await areOwnersAcceptedContacts(ownerB, ownerA)).toBe(true);
      expect(await areOwnersAcceptedContacts(ownerA, ownerC)).toBe(false);

      // Requesting again when already contacts -> 409 ALREADY_CONTACTS
      await expect(
        requestContactByHandle(ownerA, "bob_agent", "req_test"),
      ).rejects.toThrowError(ContactError);
    });

    it("decline removes pending request cleanly", async () => {
      const contact = await requestContactByHandle(ownerA, "bob_agent", "req_test");

      const result = await respondToContactRequest(contact.id, ownerB, "decline", "req_test");
      expect(result.ok).toBe(true);
      expect(result.state).toBe("declined");

      const contactsA = await getContactsForOwner(ownerA, "req_test");
      expect(contactsA.outgoing.length).toBe(0);
      expect(contactsA.contacts.length).toBe(0);

      const contactsB = await getContactsForOwner(ownerB, "req_test");
      expect(contactsB.incoming.length).toBe(0);
      expect(contactsB.contacts.length).toBe(0);

      expect(await areOwnersAcceptedContacts(ownerA, ownerB)).toBe(false);
    });

    it("bilateral remove deletes contact pair both ways", async () => {
      // Establish contact
      const contact = await requestContactByHandle(ownerA, "bob_agent", "req_test");
      await respondToContactRequest(contact.id, ownerB, "accept", "req_test");

      expect(await areOwnersAcceptedContacts(ownerA, ownerB)).toBe(true);

      // Owner A removes Owner B
      const result = await removeContact(ownerB, ownerA, "req_test");
      expect(result.ok).toBe(true);

      // Both are removed
      expect(await areOwnersAcceptedContacts(ownerA, ownerB)).toBe(false);
      expect(await areOwnersAcceptedContacts(ownerB, ownerA)).toBe(false);

      const listA = await getContactsForOwner(ownerA, "req_test");
      expect(listA.contacts.length).toBe(0);

      const listB = await getContactsForOwner(ownerB, "req_test");
      expect(listB.contacts.length).toBe(0);
    });
  });

  describe("Contact Invite Links (/c/<token>)", () => {
    it("creates invite link, resolves, consumes once, and forms bilateral contact", async () => {
      // 1. Create invite
      const { link, invite_id } = await createContactInvite(
        ownerA,
        "req_test",
        "http://localhost:3000",
      );
      expect(link).toContain("http://localhost:3000/c/ct_");

      const rawToken = link.split("/c/")[1];
      expect(rawToken.startsWith("ct_")).toBe(true);

      // 2. Resolve invite
      const resolution = await resolveContactInvite(rawToken, ownerB);
      expect(resolution.status).toBe("valid");
      if (resolution.status === "valid") {
        expect(resolution.inviterHandle).toBe("alice_agent");
        expect(resolution.inviterOwnerId).toBe(ownerA);
      }

      // 3. Inviter cannot accept own invite link
      await expect(acceptContactInvite(rawToken, ownerA, "req_test")).rejects.toThrowError(
        ContactError,
      );

      // 4. Owner B accepts invite
      const acceptRes = await acceptContactInvite(rawToken, ownerB, "req_test");
      expect(acceptRes.ok).toBe(true);
      expect(acceptRes.inviterHandle).toBe("alice_agent");

      // Verify contact formed both ways immediately
      expect(await areOwnersAcceptedContacts(ownerA, ownerB)).toBe(true);
      expect(await areOwnersAcceptedContacts(ownerB, ownerA)).toBe(true);

      // 5. Token reuse rejected
      const reResolution = await resolveContactInvite(rawToken, ownerC);
      expect(reResolution.status).toBe("used");

      await expect(acceptContactInvite(rawToken, ownerC, "req_test")).rejects.toThrowError(
        ContactError,
      );
    });

    it("rejects expired and invalid tokens with plain messages", async () => {
      // Invalid token
      const invalidRes = await resolveContactInvite("ct_nonexistent_token");
      expect(invalidRes.status).toBe("invalid");

      // Expired token
      const { link } = await createContactInvite(
        ownerA,
        "req_test",
        "http://localhost:3000",
      );
      const rawToken = link.split("/c/")[1];
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const record = memoryContactInvites.get(tokenHash);
      if (record) {
        record.expires_at = new Date(Date.now() - 1000).toISOString();
      }

      const expiredRes = await resolveContactInvite(rawToken);
      expect(expiredRes.status).toBe("expired");
    });
  });

  describe("Isolation", () => {
    it("ensures contact list only returns owner's contacts with no cross-leakage", async () => {
      // A and B are contacts
      const invAB = await createContactInvite(ownerA, "req_test", "http://localhost:3000");
      await acceptContactInvite(invAB.link.split("/c/")[1], ownerB, "req_test");

      // B and C are contacts
      const invBC = await createContactInvite(ownerB, "req_test", "http://localhost:3000");
      await acceptContactInvite(invBC.link.split("/c/")[1], ownerC, "req_test");

      // Owner A should only see B
      const listA = await getContactsForOwner(ownerA, "req_test");
      expect(listA.contacts.length).toBe(1);
      expect(listA.contacts[0].handle).toBe("bob_agent");

      // Owner C should only see B
      const listC = await getContactsForOwner(ownerC, "req_test");
      expect(listC.contacts.length).toBe(1);
      expect(listC.contacts[0].handle).toBe("bob_agent");

      // Owner B should see both A and C
      const listB = await getContactsForOwner(ownerB, "req_test");
      expect(listB.contacts.length).toBe(2);
      const handles = listB.contacts.map((c) => c.handle);
      expect(handles).toContain("alice_agent");
      expect(handles).toContain("charlie_agent");
    });
  });
});
