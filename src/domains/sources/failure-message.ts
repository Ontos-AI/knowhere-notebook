const maxFailureMessageLength = 180

type SourceFailureMessage = {
  readonly fromStoredReason: (
    reason: string | null | undefined,
  ) => string | undefined
  readonly fromUnknown: (error: unknown, fallback: string) => string
}

function fromStoredReason(
  reason: string | null | undefined,
): string | undefined {
  if (!reason) return undefined

  const message = extractBriefMessage(reason)
  if (!message) return undefined

  return truncateMessage(message)
}

function fromUnknown(error: unknown, fallback: string): string {
  return (
    fromStoredReason(readErrorMessage(error)) ??
    fromStoredReason(fallback) ??
    fallback
  )
}

function readErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    const bodyMessage = readNestedBodyMessage(error)
    const wrappedMessage = readWrappedErrorMessage(error)
    return bodyMessage ?? wrappedMessage ?? error.message
  }
  if (typeof error === "string") return error
  if (isRecord(error)) {
    const bodyMessage = readNestedBodyMessage(error)
    if (bodyMessage) return bodyMessage
    const wrappedMessage = readWrappedErrorMessage(error)
    if (wrappedMessage) return wrappedMessage
    const message = error.message
    if (typeof message === "string") return message
  }

  return undefined
}

function readWrappedErrorMessage(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined

  const wrapped = error.error ?? error.cause
  if (wrapped === undefined || wrapped === error) return undefined

  return readErrorMessage(wrapped)
}

function readNestedBodyMessage(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined

  const body = error.body
  if (!isRecord(body)) return undefined

  const nestedError = body.error
  if (!isRecord(nestedError)) return undefined

  return typeof nestedError.message === "string"
    ? nestedError.message
    : undefined
}

function extractBriefMessage(value: string): string {
  const normalized = value.replace(/\r/g, "\n")
  const messageProperty = normalized.match(
    /['"]?message['"]?\s*:\s*['"]([^'"]+)['"]/u,
  )
  if (messageProperty?.[1]) {
    return collapseWhitespace(messageProperty[1])
  }

  const firstMeaningfulLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find(isMeaningfulFailureLine)
  if (!firstMeaningfulLine) return ""

  const errorMatch = firstMeaningfulLine.match(
    /Error(?:\s+\[[^\]]+\])?:\s*(.+)$/u,
  )
  if (errorMatch?.[1]) {
    return collapseWhitespace(errorMatch[1])
  }

  return collapseWhitespace(
    firstMeaningfulLine.replace(/^Error:\s*/u, ""),
  )
}

function isMeaningfulFailureLine(line: string): boolean {
  if (!line) return false
  if (line.startsWith("at ")) return false
  if (line.startsWith("<unknown>")) return false
  if (/^(statusCode|code|requestId|details|body|retryAfter):/u.test(line)) {
    return false
  }

  return true
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateMessage(message: string): string {
  if (message.length <= maxFailureMessageLength) return message
  return `${message.slice(0, maxFailureMessageLength - 3).trimEnd()}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export const sourceFailureMessage: SourceFailureMessage = {
  fromStoredReason,
  fromUnknown,
}
