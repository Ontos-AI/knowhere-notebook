import "server-only"

type LogLevel = "info" | "warn" | "error"

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
    const { ts, level, msg, ...meta } = entry
    const metaStr = Object.keys(meta).length > 0 ? " " + JSON.stringify(meta) : ""
    return `${ts} ${prefix} ${msg}${metaStr}`
  }
  return JSON.stringify(entry)
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
