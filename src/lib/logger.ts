import "server-only"

type LogLevel = "info" | "warn" | "error"
const LOG_JSON_INDENT = 2

interface LogEntry {
  ts: string
  level: LogLevel
  msg: string
  [key: string]: unknown
}

function formatLog(entry: LogEntry): string {
  if (process.env.NODE_ENV === "development") {
    const color = { info: 36, warn: 33, error: 31 }[entry.level]
    const prefix = `\x1b[${color}m${entry.level.toUpperCase()}\x1b[0m`
    const meta = Object.fromEntries(
      Object.entries(entry).filter(
        ([key]) => key !== "ts" && key !== "level" && key !== "msg",
      ),
    )
    const metaStr =
      Object.keys(meta).length > 0
        ? `\n${stringifyLogJson(meta, LOG_JSON_INDENT)}`
        : ""
    return `${entry.ts} ${prefix} ${entry.msg}${metaStr}`
  }
  return stringifyLogJson(entry, LOG_JSON_INDENT)
}

function stringifyLogJson(value: unknown, space: number): string {
  return JSON.stringify(value, createLogJsonReplacer(), space) ?? String(value)
}

function createLogJsonReplacer(): (key: string, value: unknown) => unknown {
  const seenObjects = new WeakSet<object>()
  return (_key: string, value: unknown): unknown => {
    if (typeof value === "bigint") return value.toString()
    if (typeof value === "function") {
      return `[Function ${value.name || "anonymous"}]`
    }
    if (typeof value === "symbol") return value.toString()
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }
    if (!value || typeof value !== "object") return value
    if (seenObjects.has(value)) return "[Circular]"
    seenObjects.add(value)
    return value
  }
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  }
  const line = formatLog(entry)

  if (level === "error") {
    console.error(line)
  } else if (level === "warn") {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  info(msg: string, meta?: Record<string, unknown>) {
    log("info", msg, meta)
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    log("warn", msg, meta)
  },
  error(msg: string, meta?: Record<string, unknown>) {
    log("error", msg, meta)
  },
}
