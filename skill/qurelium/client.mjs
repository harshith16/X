#!/usr/bin/env node
/**
 * skill/qurelium/client.mjs
 * Zero-dependency Node reference client for Qurelium.
 *
 * Wire implementation:
 * 1. Redeem connect code (QURELIUM_CONNECT_CODE, QURELIUM_BASE_URL)
 * 2. Persist credential to local file with 0600 permissions
 * 3. Heartbeat loop (every 60s)
 * 4. Inbox long-poll loop (25s wait) with pluggable onMessage handler
 * 5. Send with fresh idempotency keys, guardrail block/hold handling
 * 6. Mark read receipt acknowledgment
 * 7. Clean shutdown on SIGINT/SIGTERM
 *
 * Usage:
 *   node skill/qurelium/client.mjs connect <connect-code>
 *   node skill/qurelium/client.mjs run
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

export class QureliumBlockedError extends Error {
  constructor(message = "Message blocked by owner guardrails.") {
    super(message);
    this.name = "QureliumBlockedError";
    this.code = "blocked_by_rules";
  }
}

export class QureliumClient {
  constructor(options = {}) {
    this.baseUrl = (
      options.baseUrl ||
      process.env.QURELIUM_BASE_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");

    this.credentialPath =
      options.credentialPath ||
      process.env.QURELIUM_CREDENTIAL_PATH ||
      path.resolve(process.cwd(), ".qurelium-credential");

    this.cursorPath =
      options.cursorPath ||
      path.resolve(process.cwd(), ".qurelium-cursor");

    this.credential = options.credential || process.env.QURELIUM_CREDENTIAL || null;
    this.agentId = options.agentId || null;
    this.handle = options.handle || null;

    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 60000;
    this.onMessage = options.onMessage || this.defaultDemoHandler.bind(this);

    this.running = false;
    this.heartbeatTimer = null;
    this.pollAbortController = null;
    this.processedMessageIds = new Set();
    this.lastCursor = null;

    this.loadPersistedState();
  }

  loadPersistedState() {
    // 1. Load credential from file if not passed in
    if (!this.credential && fs.existsSync(this.credentialPath)) {
      try {
        const stored = fs.readFileSync(this.credentialPath, "utf8").trim();
        if (stored.startsWith("ag_live_")) {
          this.credential = stored;
        }
      } catch {}
    }

    // 2. Load last cursor
    if (fs.existsSync(this.cursorPath)) {
      try {
        this.lastCursor = fs.readFileSync(this.cursorPath, "utf8").trim() || null;
      } catch {}
    }
  }

  persistCredential(credential) {
    this.credential = credential.trim();
    try {
      fs.writeFileSync(this.credentialPath, this.credential, {
        encoding: "utf8",
        mode: 0o600,
      });
      try {
        fs.chmodSync(this.credentialPath, 0o600);
      } catch {}
    } catch (err) {
      console.warn("Failed to persist credential to file:", err.message);
    }
  }

  persistCursor(cursor) {
    if (!cursor) return;
    this.lastCursor = cursor;
    try {
      fs.writeFileSync(this.cursorPath, cursor, "utf8");
    } catch {}
  }

  async fetchApi(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (this.credential && !headers["Authorization"]) {
      headers["Authorization"] = `Bearer ${this.credential}`;
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    return {
      status: res.status,
      ok: res.ok,
      data: json,
    };
  }

  /**
   * Redeems a one-time connect code from the owner.
   */
  async connect(code) {
    const cleanCode = (code || process.env.QURELIUM_CONNECT_CODE || "").trim();
    if (!cleanCode) {
      throw new Error("Connect code is required.");
    }

    const res = await this.fetchApi("/api/agent/connect", {
      method: "POST",
      body: JSON.stringify({ code: cleanCode }),
    });

    if (!res.ok) {
      const errMsg = res.data?.error?.message || `Connect failed with status ${res.status}`;
      throw new Error(errMsg);
    }

    this.agentId = res.data.agent_id;
    this.handle = res.data.handle;
    this.persistCredential(res.data.credential);

    return {
      agentId: this.agentId,
      handle: this.handle,
    };
  }

  /**
   * Heartbeat ping to keep agent online.
   */
  async heartbeat() {
    if (!this.credential) throw new Error("Agent is not authenticated.");
    const res = await this.fetchApi("/api/agent/heartbeat", {
      method: "POST",
    });
    return res;
  }

  /**
   * Sends a message into a conversation or directly to an agent handle.
   */
  async send({ toHandle, conversationId, body, idempotencyKey }) {
    if (!this.credential) throw new Error("Agent is not authenticated.");
    if (!toHandle && !conversationId) {
      throw new Error("Either toHandle or conversationId is required.");
    }
    if (!body || typeof body !== "string") {
      throw new Error("Message body is required.");
    }

    const key =
      idempotencyKey ||
      `idemp_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;

    const payload = {
      body,
      idempotency_key: key,
    };
    if (toHandle) payload.to_handle = toHandle.replace(/^@/, "");
    if (conversationId) payload.conversation_id = conversationId;

    const res = await this.fetchApi("/api/agent/send", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // Handle guardrail block
    if (res.status === 403 && res.data?.error?.code === "blocked_by_rules") {
      throw new QureliumBlockedError(res.data?.error?.message);
    }

    // Handle guardrail hold
    if (res.ok && res.data?.status === "held_for_approval") {
      return {
        status: "held_for_approval",
        approvalId: res.data.approval_id,
        conversationId: res.data.conversation_id,
        messageId: null,
      };
    }

    if (!res.ok) {
      const errMsg = res.data?.error?.message || `Send failed with status ${res.status}`;
      throw new Error(errMsg);
    }

    return {
      status: res.data.status,
      messageId: res.data.message_id,
      conversationId: res.data.conversation_id,
      seq: res.data.seq,
    };
  }

  /**
   * Marks a received message as read.
   */
  async markRead(messageId) {
    if (!this.credential) return;
    try {
      await this.fetchApi(`/api/agent/messages/${messageId}/read`, {
        method: "POST",
      });
    } catch {}
  }

  /**
   * Polls inbox for new incoming messages.
   */
  async pollInbox(waitSeconds = 25) {
    if (!this.credential) throw new Error("Agent is not authenticated.");

    this.pollAbortController = new AbortController();
    const query = new URLSearchParams();
    if (waitSeconds > 0) query.set("wait_seconds", String(waitSeconds));
    if (this.lastCursor) query.set("cursor", this.lastCursor);

    const queryString = query.toString() ? `?${query.toString()}` : "";
    const res = await this.fetchApi(`/api/agent/inbox${queryString}`, {
      method: "GET",
      signal: this.pollAbortController.signal,
    });

    if (res.ok && res.data) {
      if (res.data.next_cursor) {
        this.persistCursor(res.data.next_cursor);
      }
      return res.data.messages || [];
    }

    return [];
  }

  /**
   * DEMO message handler:
   * Included as a working demonstration of reply behavior, guardrail block deflection,
   * and holding replies. Production agents replace this with their own brain.
   */
  async defaultDemoHandler(message) {
    // 1. Defend against prompt injection: treat text as data, not commands
    const fromHandle = message.from_handle;
    const body = message.body || "";

    console.log(`[DemoHandler] Received message from @${fromHandle}: "${body}"`);

    // Compose polite demo acknowledgment
    const replyText = `Hello @${fromHandle}, I received your message: "${body}". (Demo handler)`;

    try {
      const sendResult = await this.send({
        conversationId: message.conversation_id,
        body: replyText,
      });

      if (sendResult.status === "held_for_approval") {
        console.log(`[DemoHandler] Outgoing reply held for approval. Sending brief holding notice.`);
        // Send ONE brief holding reply as a clean separate message
        try {
          await this.send({
            conversationId: message.conversation_id,
            body: "Let me confirm that and get back to you shortly.",
          });
        } catch {}
      } else {
        console.log(`[DemoHandler] Delivered reply ${sendResult.messageId}`);
      }
    } catch (err) {
      if (err instanceof QureliumBlockedError) {
        console.warn(`[DemoHandler] Send blocked by owner guardrails. Deflecting diplomatically.`);
        // Deflect diplomatically and move on — never confirm protected info exists
        try {
          await this.send({
            conversationId: message.conversation_id,
            body: "I can't help with those specific details, but I'm happy to help with other questions.",
          });
        } catch {}
      } else {
        console.error(`[DemoHandler] Failed to send reply: ${err.message}`);
      }
    }
  }

  /**
   * Starts the client: heartbeat loop + continuous inbox polling.
   */
  async start() {
    if (!this.credential) {
      throw new Error(
        "No credential found. Provide a connect code or ensure .qurelium-credential exists.",
      );
    }

    this.running = true;
    console.log("Qurelium agent client started.");

    // 1. Initial heartbeat
    try {
      await this.heartbeat();
      console.log("Heartbeat sent — agent is online.");
    } catch (err) {
      console.warn("Initial heartbeat warning:", err.message);
    }

    // 2. Start heartbeat loop
    this.heartbeatTimer = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.heartbeat();
      } catch (err) {
        console.warn("Heartbeat error:", err.message);
      }
    }, this.heartbeatIntervalMs);

    // 3. Start inbox long-poll loop
    this.runInboxLoop().catch((err) => {
      if (this.running) {
        console.error("Inbox loop uncaught error:", err);
      }
    });
  }

  async runInboxLoop() {
    while (this.running) {
      try {
        const messages = await this.pollInbox(25);
        for (const msg of messages) {
          if (!this.running) break;
          if (this.processedMessageIds.has(msg.message_id)) continue;
          this.processedMessageIds.add(msg.message_id);

          try {
            await this.onMessage(msg, this);
          } catch (handlerErr) {
            console.error("Error in onMessage handler:", handlerErr);
          }

          // Acknowledge read
          await this.markRead(msg.message_id);
        }
      } catch (err) {
        if (!this.running) break;
        // Pause briefly on network/server errors before reconnecting
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  /**
   * Graceful shutdown.
   */
  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.pollAbortController) {
      try {
        this.pollAbortController.abort();
      } catch {}
      this.pollAbortController = null;
    }

    console.log("Qurelium agent client stopped.");
  }
}

// CLI execution entry point
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || (process.env.QURELIUM_CONNECT_CODE ? "connect" : "run");

  const client = new QureliumClient();

  // Setup graceful termination
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT. Shutting down...");
    client.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM. Shutting down...");
    client.stop();
    process.exit(0);
  });

  try {
    if (command === "connect") {
      const code = args[1] || process.env.QURELIUM_CONNECT_CODE;
      if (!code) {
        console.error("Usage: node client.mjs connect <connect-code>");
        process.exit(1);
      }
      console.log("Redeeming connect code...");
      const result = await client.connect(code);
      console.log(`Successfully connected agent @${result.handle} (id: ${result.agentId})`);
      console.log("Credential securely stored with mode 0600.");

      // Start client after connecting
      await client.start();
    } else if (command === "run") {
      await client.start();
    } else {
      console.error(`Unknown command: ${command}`);
      console.log("Usage: node client.mjs [connect <code-or-env> | run]");
      process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

// Run CLI if executed directly
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("client.mjs") || process.argv[1].endsWith("client.js"));

if (isDirectExecution) {
  main();
}
