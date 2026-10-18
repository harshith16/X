#!/usr/bin/env node
/**
 * scripts/test-agent.mjs
 * Dev CLI test client for external agent programs.
 * Connects with a code, heartbeats, sends messages, polls inbox, and marks read.
 *
 * Usage:
 *   node scripts/test-agent.mjs connect <code>
 *   node scripts/test-agent.mjs heartbeat <credential>
 *   node scripts/test-agent.mjs send <credential> <to_handle> <body> [idempotency_key]
 *   node scripts/test-agent.mjs inbox <credential> [wait_seconds] [cursor]
 *   node scripts/test-agent.mjs read <credential> <message_id>
 *   node scripts/test-agent.mjs status <credential> <message_id>
 */

const BASE_URL = process.env.TEST_APP_URL || "http://localhost:3000";

function maskSecret(str) {
  if (!str || typeof str !== "string") return "<empty>";
  if (str.length <= 8) return str.slice(0, 2) + "...";
  return str.slice(0, 7) + "..." + `(len: ${str.length})`;
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, ok: res.ok, data: json };
  } finally {
    clearTimeout(timer);
  }
}

export async function connectAgent(code) {
  const res = await request("/api/agent/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return res;
}

export async function heartbeatAgent(credential) {
  const res = await request("/api/agent/heartbeat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
  });
  return res;
}

export async function sendMessage(credential, toHandle, body, idempotencyKey) {
  const key = idempotencyKey || `test_key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await request("/api/agent/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to_handle: toHandle,
      body,
      idempotency_key: key,
    }),
  });
  return res;
}

export async function pollInbox(credential, waitSeconds = 0, cursor = undefined) {
  const params = new URLSearchParams();
  if (waitSeconds > 0) params.set("wait_seconds", String(waitSeconds));
  if (cursor) params.set("cursor", cursor);

  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await request(`/api/agent/inbox${query}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credential}`,
    },
    timeoutMs: (waitSeconds + 10) * 1000,
  });
  return res;
}

export async function markRead(credential, messageId) {
  const res = await request(`/api/agent/messages/${messageId}/read`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
  });
  return res;
}

export async function getMessageStatus(credential, messageId) {
  const res = await request(`/api/agent/messages/${messageId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credential}`,
    },
  });
  return res;
}

// CLI handler
async function main() {
  const [,, cmd, arg1, arg2, arg3, arg4] = process.argv;

  if (!cmd) {
    console.log("Usage: node scripts/test-agent.mjs <command> [args...]");
    console.log("Commands: connect, heartbeat, send, inbox, read, status");
    process.exit(1);
  }

  try {
    switch (cmd) {
      case "connect": {
        const code = arg1;
        if (!code) throw new Error("Missing connect code");
        console.log(`Connecting with code: ${maskSecret(code)}`);
        const res = await connectAgent(code);
        if (!res.ok) {
          console.error(`Connect failed (${res.status}):`, res.data);
          process.exit(1);
        }
        console.log("Connected successfully!");
        console.log(`  Agent ID:   ${res.data.agent_id}`);
        console.log(`  Handle:     @${res.data.handle}`);
        console.log(`  Credential: ${maskSecret(res.data.credential)}`);
        break;
      }

      case "heartbeat": {
        const cred = arg1;
        if (!cred) throw new Error("Missing credential");
        console.log(`Sending heartbeat with credential: ${maskSecret(cred)}`);
        const res = await heartbeatAgent(cred);
        console.log(`Heartbeat status: ${res.status}`, res.data);
        break;
      }

      case "send": {
        const cred = arg1;
        const toHandle = arg2;
        const body = arg3;
        const idempKey = arg4;
        if (!cred || !toHandle || !body) {
          throw new Error("Usage: send <credential> <to_handle> <body> [idempotency_key]");
        }
        console.log(`Sending message to @${toHandle}...`);
        const res = await sendMessage(cred, toHandle, body, idempKey);
        console.log(`Send status: ${res.status}`, res.data);
        break;
      }

      case "inbox": {
        const cred = arg1;
        const wait = arg2 ? Number(arg2) : 0;
        const cursor = arg3;
        if (!cred) throw new Error("Missing credential");
        console.log(`Polling inbox (wait: ${wait}s)...`);
        const res = await pollInbox(cred, wait, cursor);
        console.log(`Inbox status: ${res.status}`);
        if (res.data?.messages) {
          console.log(`Retrieved ${res.data.messages.length} message(s):`);
          for (const m of res.data.messages) {
            console.log(`  [${m.status}] from @${m.from_handle}: "${m.body}" (id: ${m.message_id})`);
          }
        } else {
          console.log("Response:", res.data);
        }
        break;
      }

      case "read": {
        const cred = arg1;
        const msgId = arg2;
        if (!cred || !msgId) throw new Error("Usage: read <credential> <message_id>");
        const res = await markRead(cred, msgId);
        console.log(`Mark read status: ${res.status}`, res.data);
        break;
      }

      case "status": {
        const cred = arg1;
        const msgId = arg2;
        if (!cred || !msgId) throw new Error("Usage: status <credential> <message_id>");
        const res = await getMessageStatus(cred, msgId);
        console.log(`Message status: ${res.status}`, res.data);
        break;
      }

      default:
        console.error(`Unknown command: ${cmd}`);
        process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("test-agent.mjs")) {
  main();
}
