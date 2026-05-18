type LogValue =
  | string
  | number
  | boolean
  | null
  | readonly LogValue[]
  | { readonly [key: string]: LogValue }

const maxDepth = 8
const maxSummaryDepth = 16
const maxStackLines = 12

export function formatUnknownForLog(value: unknown): string {
  const normalizedValue = normalizeLogValue(value, 0, new WeakSet<object>())
  if (typeof normalizedValue === "string") return normalizedValue

  try {
    const json = JSON.stringify(normalizedValue)
    if (json !== undefined) return json
  } catch {
    // Fall through to String for non-serializable values.
  }

  return String(value)
}

export function summarizeUnknownError(value: unknown): string {
  return (
    findErrorMessage(value, 0, new WeakSet<object>()) ??
    formatUnknownForLog(value)
  )
}

function normalizeLogValue(
  value: unknown,
  depth: number,
  seenObjects: WeakSet<object>,
): LogValue {
  if (value === null) return null
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "undefined") return "undefined"
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value)
  }
  if (depth >= maxDepth) return "[MaxDepth]"

  if (value instanceof Error) {
    return normalizeError(value, depth, seenObjects)
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    if (seenObjects.has(value)) return "[Circular]"
    seenObjects.add(value)
    return value.map((item) =>
      normalizeLogValue(item, depth + 1, seenObjects),
    )
  }

  if (seenObjects.has(value)) return "[Circular]"
  seenObjects.add(value)

  const output: Record<string, LogValue> = {}
  for (const key of getObjectPropertyKeys(value)) {
    const propertyValue = readObjectProperty(value, key)
    output[getLogPropertyName(key)] = normalizeLogValue(
      propertyValue,
      depth + 1,
      seenObjects,
    )
  }

  return Object.keys(output).length > 0 ? output : String(value)
}

function normalizeError(
  error: Error,
  depth: number,
  seenObjects: WeakSet<object>,
): LogValue {
  if (seenObjects.has(error)) return "[Circular]"
  seenObjects.add(error)

  const output: Record<string, LogValue> = {
    name: error.name,
    message: error.message,
  }

  if (error.cause !== undefined) {
    output.cause = normalizeLogValue(error.cause, depth + 1, seenObjects)
  }
  if (error.stack) {
    output.stack = error.stack.split("\n").slice(0, maxStackLines).join("\n")
  }

  for (const key of getObjectPropertyKeys(error)) {
    if (
      key === "name" ||
      key === "message" ||
      key === "cause" ||
      key === "stack"
    ) {
      continue
    }
    output[getLogPropertyName(key)] = normalizeLogValue(
      readObjectProperty(error, key),
      depth + 1,
      seenObjects,
    )
  }

  return output
}

function findErrorMessage(
  value: unknown,
  depth: number,
  seenObjects: WeakSet<object>,
): string | null {
  if (depth >= maxSummaryDepth) return null
  if (typeof value === "string" && value.trim().length > 0) return value
  if (typeof value !== "object" || value === null) return null
  if (seenObjects.has(value)) return null
  seenObjects.add(value)

  if (value instanceof Error) {
    const nestedMessage =
      findErrorMessage(value.cause, depth + 1, seenObjects) ??
      findSymbolErrorMessage(value, depth, seenObjects)
    const ownMessage = isSpecificMessage(value.message) ? value.message : null

    if (ownMessage && !isWrapperMessage(value, ownMessage)) return ownMessage
    return nestedMessage ?? ownMessage
  }

  for (const key of ["failure", "error", "cause", "defect"] as const) {
    const nestedMessage = findErrorMessage(
      readObjectProperty(value, key),
      depth + 1,
      seenObjects,
    )
    if (nestedMessage) return nestedMessage
  }

  const message = readObjectProperty(value, "message")
  if (typeof message === "string" && isSpecificMessage(message)) return message

  return null
}

function findSymbolErrorMessage(
  value: object,
  depth: number,
  seenObjects: WeakSet<object>,
): string | null {
  for (const key of Object.getOwnPropertySymbols(value)) {
    const nestedMessage = findErrorMessage(
      readObjectProperty(value, key),
      depth + 1,
      seenObjects,
    )
    if (nestedMessage) return nestedMessage
  }

  return null
}

function isSpecificMessage(message: string): boolean {
  const trimmedMessage = message.trim()
  return (
    trimmedMessage.length > 0 &&
    trimmedMessage !== "An unknown error occurred in Effect.tryPromise"
  )
}

function isWrapperMessage(error: Error, message: string): boolean {
  const tag = readObjectProperty(error, "_tag")
  return (
    tag === "EffectOperationError" ||
    error.name.includes("EffectOperationError") ||
    error.name.includes("FiberFailure") ||
    message.startsWith("Effect operation ") ||
    message.startsWith("Failed query:") ||
    message.endsWith(" failed")
  )
}

function getObjectPropertyKeys(value: object): readonly (string | symbol)[] {
  return [
    ...Object.getOwnPropertyNames(value),
    ...Object.getOwnPropertySymbols(value),
  ]
}

function getLogPropertyName(key: string | symbol): string {
  if (typeof key === "string") return key
  return key.description ? `[${key.description}]` : String(key)
}

function readObjectProperty(value: object, key: string | symbol): unknown {
  try {
    return (value as Readonly<Record<PropertyKey, unknown>>)[key]
  } catch (error) {
    return [
      `Unable to read property ${getLogPropertyName(key)}:`,
      String(error),
    ].join(" ")
  }
}
