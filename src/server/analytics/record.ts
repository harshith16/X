import fs from "fs";
import path from "path";
import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";

export interface AnalyticsEventRecord {
  id: string;
  event: string;
  properties: Record<string, unknown>;
  created_at: string;
}

export class AnalyticsValidationError extends Error {
  constructor(key: string) {
    super(
      `Analytics property '${key}' is banned by privacy denylist. Analytics must contain IDs, timestamps, and outcome classes ONLY.`,
    );
    this.name = "AnalyticsValidationError";
  }
}

const BANNED_KEYS = [
  "body",
  "text",
  "email",
  "name",
  "display_name",
  "secret",
  "token",
  "password",
  "content",
  "prompt",
  "message",
];

/**
 * Validates properties against the strict throwing denylist.
 * Throws immediately if any banned key is present.
 */
export function validateProperties(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    const lowerKey = key.toLowerCase().trim();
    if (BANNED_KEYS.includes(lowerKey)) {
      throw new AnalyticsValidationError(key);
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      if (typeof value === "object" && !Array.isArray(value)) {
        validateProperties(value as Record<string, unknown>);
      } else {
        throw new Error(
          `Analytics property '${key}' has invalid type '${typeof value}'. Only primitive scalars are allowed.`,
        );
      }
    }
  }
}

// In-memory capture fallback when analytics_events table is pending migration
const globalForAnalytics = globalThis as unknown as {
  __memoryAnalyticsEvents?: AnalyticsEventRecord[];
};

export const memoryAnalyticsEvents = (globalForAnalytics.__memoryAnalyticsEvents ??= []);

const DEV_CAPTURE_FILE = path.resolve(process.cwd(), ".analytics-events.jsonl");

/**
 * Records a metadata-only analytics event (Capture-only, 8e).
 * Throws AnalyticsValidationError if any banned key (e.g. text, body, email, name) is passed.
 */
export async function record(
  event: string,
  properties: Record<string, unknown> = {},
  requestId?: string,
): Promise<void> {
  // Enforce throwing denylist
  validateProperties(properties);

  const entry: AnalyticsEventRecord = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    event,
    properties,
    created_at: new Date().toISOString(),
  };

  memoryAnalyticsEvents.push(entry);

  // In non-production, persist to dev capture file for local verification
  if (process.env.NODE_ENV !== "production") {
    try {
      fs.appendFileSync(DEV_CAPTURE_FILE, JSON.stringify(entry) + "\n", "utf8");
    } catch {}
  }

  const db = getServiceClient();
  try {
    const { error } = await db.from("analytics_events").insert({
      event,
      properties,
    });

    if (error && error.code !== "PGRST205") {
      logger.warn({
        msg: `Failed to insert analytics event ${event}: ${error.message}`,
        request_id: requestId || "internal_analytics",
      });
    }
  } catch {}
}

/**
 * Internal test helper for unit tests.
 */
export async function getRecordedEvents(eventName?: string): Promise<AnalyticsEventRecord[]> {
  if (eventName) {
    return memoryAnalyticsEvents.filter((e) => e.event === eventName);
  }
  return [...memoryAnalyticsEvents];
}

/**
 * Internal test helper for unit tests.
 */
export function clearRecordedEvents(): void {
  memoryAnalyticsEvents.length = 0;
  if (process.env.NODE_ENV !== "production") {
    try {
      if (fs.existsSync(DEV_CAPTURE_FILE)) {
        fs.unlinkSync(DEV_CAPTURE_FILE);
      }
    } catch {}
  }
}
