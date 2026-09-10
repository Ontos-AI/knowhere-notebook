import type { MemorySearchResponse } from "./types"

type ErrorTextInput = {
  readonly operation: MemoryOperation
  readonly message: string
}

type MemoryOperation = "search"

export const memoryToolText = {
  formatSearch(response: MemorySearchResponse): string {
    return wrapMemoryBlock("search", [
      formatTag("summary", {
        query: response.query,
        resultCount: String(response.items.length),
      }),
      formatMemoryItems(response),
    ])
  },

  formatError(input: ErrorTextInput): string {
    return [
      formatOpenTag("memory", {
        operation: input.operation,
        status: "error",
      }),
      formatTextTag("message", input.message),
      "</memory>",
    ].join("\n")
  },
} as const

function formatMemoryItems(response: MemorySearchResponse): string {
  if (response.items.length === 0) return ""

  return [
    "<items>",
    ...response.items.map((item) =>
      [
        formatOpenTag("item", {
          ref: item.ref,
          itemId: item.itemId,
          kind: item.kind,
        }),
        formatTextTag("abstract_l0", item.abstractL0),
        formatTextTag("overview_l1", item.overviewL1),
        "</item>",
      ].join("\n"),
    ),
    "</items>",
  ].join("\n")
}

function wrapMemoryBlock(
  operation: MemoryOperation,
  parts: readonly string[],
): string {
  return [
    formatOpenTag("memory", { operation, status: "ok" }),
    ...parts.filter((part) => part.trim().length > 0),
    "</memory>",
  ].join("\n")
}

function formatTextTag(tagName: string, value: string): string {
  return [`<${tagName}>`, value, `</${tagName}>`].join("\n")
}

function formatTag(
  tagName: string,
  attrs: Readonly<Record<string, string | undefined>>,
): string {
  return `${formatOpenTag(tagName, attrs)}</${tagName}>`
}

function formatOpenTag(
  tagName: string,
  attrs: Readonly<Record<string, string | undefined>>,
): string {
  const serializedAttrs = Object.entries(attrs)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(" ")
  return serializedAttrs ? `<${tagName} ${serializedAttrs}>` : `<${tagName}>`
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
