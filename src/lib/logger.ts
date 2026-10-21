export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogPayload {
  msg: string;
  request_id: string;
  route?: string;
  duration_ms?: number;
  owner_id?: string;
  agent_id?: string;
  conversation_id?: string;
  message_id?: string;
  idempotency_key?: string;
  error?: string;
  handle?: string;
  approval_id?: string;
  fact_id?: string;
}

export interface LogEntry extends LogPayload {
  level: LogLevel;
}

export type LogMeta = Omit<LogPayload, "msg">;

export function newRequestId(): string {
  return crypto.randomUUID();
}

function writeLog(entry: LogEntry): void {
  // Writes single-line JSON with fields {level, msg, request_id, route?, duration_ms?}
  const line = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function normalizeArgs(msgOrPayload: string | LogPayload, meta?: LogMeta): LogPayload {
  if (typeof msgOrPayload === "string") {
    if (!meta) {
      throw new Error("Logger requires request_id in metadata");
    }
    return {
      msg: msgOrPayload,
      ...meta,
    };
  }
  return msgOrPayload;
}

export const logger = {
  log(level: LogLevel, msgOrPayload: string | LogPayload, meta?: LogMeta): void {
    const payload = normalizeArgs(msgOrPayload, meta);
    writeLog({ level, ...payload });
  },
  info(msgOrPayload: string | LogPayload, meta?: LogMeta): void {
    const payload = normalizeArgs(msgOrPayload, meta);
    writeLog({ level: "info", ...payload });
  },
  warn(msgOrPayload: string | LogPayload, meta?: LogMeta): void {
    const payload = normalizeArgs(msgOrPayload, meta);
    writeLog({ level: "warn", ...payload });
  },
  error(msgOrPayload: string | LogPayload, meta?: LogMeta): void {
    const payload = normalizeArgs(msgOrPayload, meta);
    writeLog({ level: "error", ...payload });
  },
  debug(msgOrPayload: string | LogPayload, meta?: LogMeta): void {
    const payload = normalizeArgs(msgOrPayload, meta);
    writeLog({ level: "debug", ...payload });
  },
};
