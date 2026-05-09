export function formatUnknownForLog(value: unknown): string {
  if (typeof value === "string") return value

  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // Fall through to String for non-serializable values.
  }

  return String(value)
}
