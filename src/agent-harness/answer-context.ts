import type { ModelMessage } from "ai"

import type {
  AgentFeedbackLesson,
  EvidenceLedgerSnapshot,
  EvidencePart,
  MemorySearchItem,
  WorkspaceProfile,
} from "./types"

type UserContentParts = Exclude<
  Extract<ModelMessage, { role: "user" }>["content"],
  string
>

export async function composeAnswerContext(input: {
  readonly ledger: EvidenceLedgerSnapshot
  readonly memoryItems: readonly MemorySearchItem[]
  readonly memorySearchAttempted?: boolean
  readonly userText: string
  readonly profile?: WorkspaceProfile | null
  readonly agentFeedbackLessons?: readonly AgentFeedbackLesson[]
}): Promise<ModelMessage> {
  const content: UserContentParts = []

  const profileText = formatProfile(input.profile)
  if (profileText) {
    appendText(content, `## User Profile\n${profileText}`)
  }

  if (input.agentFeedbackLessons && input.agentFeedbackLessons.length > 0) {
    appendText(
      content,
      [
        "## Lessons from Past Mistakes",
        ...input.agentFeedbackLessons.map(formatLesson),
      ].join("\n\n"),
    )
  }

  if (input.ledger.evidence.length === 0 && input.ledger.retrievalCount > 0) {
    appendText(
      content,
      "## Evidence from Knowledge Base\nNo knowledge base results were found for this search. Answer using your own knowledge only, and say so if relevant.",
    )
  }

  if (input.ledger.evidence.length > 0) {
    appendText(content, "## Evidence from Knowledge Base")
    appendRawText(content, "\n")
    for (const part of input.ledger.evidence) {
      appendEvidencePart(content, part)
    }
  }

  if (input.memoryItems.length > 0) {
    appendText(content, [
      "## Fluid Memory",
      ...input.memoryItems.map(formatMemoryItem),
    ].join("\n\n"))
  } else if (input.memorySearchAttempted) {
    appendText(
      content,
      "## Fluid Memory\nNo fluid memory results were found for this search.",
    )
  }

  const userText = input.userText.trim()
  if (userText) {
    appendText(content, `## User's Question\n${userText}`)
  }

  return { role: "user", content }
}

function appendEvidencePart(
  content: UserContentParts,
  part: EvidencePart,
): void {
  if (part.type === "text") {
    appendRawText(content, part.text)
    return
  }
  content.push({
    type: "image",
    image: decodeBase64(part.data),
    mediaType: part.mediaType,
  })
}

function appendText(
  content: UserContentParts,
  text: string,
): void {
  const trimmed = text.trim()
  if (!trimmed) return
  const previous = content.at(-1)
  if (previous?.type === "text") {
    previous.text = `${previous.text}\n\n${trimmed}`
    return
  }
  content.push({ type: "text", text: trimmed })
}

function appendRawText(content: UserContentParts, text: string): void {
  if (text.length === 0) return
  const previous = content.at(-1)
  if (previous?.type === "text") {
    previous.text += text
    return
  }
  content.push({ type: "text", text })
}

function formatProfile(profile: WorkspaceProfile | null | undefined): string | null {
  if (!profile) return null
  const lines = (
    [
      ["name", profile.name],
      ["occupation", profile.occupation],
      ["ageStage", profile.ageStage],
      ["communicationHabit", profile.communicationHabit],
      ["workHabit", profile.workHabit],
    ] as const
  ).flatMap(([key, value]) =>
    value && value.length > 0 ? [`${key}: ${value}`] : [],
  )
  return lines.length > 0 ? lines.join("\n") : null
}

function formatLesson(lesson: AgentFeedbackLesson): string {
  return [lesson.text.trim(), lesson.reflection.trim()]
    .filter((part) => part.length > 0)
    .join("\n")
}

function formatMemoryItem(item: MemorySearchItem): string {
  return [
    `[memory ref="${item.ref}" kind="${item.kind}"]`,
    item.text.trim(),
  ]
    .filter((part) => part.length > 0)
    .join("\n")
}

function decodeBase64(data: string): Uint8Array {
  const buffer = Buffer.from(data, "base64")
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}
