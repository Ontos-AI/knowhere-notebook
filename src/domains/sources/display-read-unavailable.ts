const sourceUnavailableMessage: string =
  "Source is unavailable. The parsed document is not available locally and could not be loaded from Knowhere."

function isDisplayReadUnavailableError(error: unknown): boolean {
  const details = readErrorDetails(error)
  if (
    details.name === "NotFoundError" &&
    details.message.toLowerCase().includes("document not found")
  ) {
    return true
  }

  const causeDetails = readErrorDetails(details.cause)
  return (
    causeDetails.name === "NotFoundError" &&
    causeDetails.message.toLowerCase().includes("document not found")
  )
}

function readErrorDetails(error: unknown): {
  readonly name: string
  readonly message: string
  readonly cause: unknown
} {
  if (!isRecord(error)) {
    return {
      name: "",
      message: String(error),
      cause: undefined,
    }
  }

  return {
    name: typeof error.name === "string" ? error.name : "",
    message: typeof error.message === "string" ? error.message : "",
    cause: error.cause,
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

export const displayReadUnavailable = {
  isError: isDisplayReadUnavailableError,
  message: sourceUnavailableMessage,
} as const
