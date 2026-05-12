const fallbackChatTitle = "New chat"
const maximumChatTitleLength = 80

export function deriveChatThreadTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) return fallbackChatTitle
  if (normalized.length <= maximumChatTitleLength) return normalized
  return `${normalized.slice(0, maximumChatTitleLength - 3)}...`
}
