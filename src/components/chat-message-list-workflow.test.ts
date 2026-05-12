// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessageView } from "@/domains/chat/types"

const virtualizerMocks = vi.hoisted(() => ({
  getTotalSize: vi.fn(() => 320),
  getVirtualItems: vi.fn(() => [
    { index: 0, key: "row_0", start: 0 },
    { index: 1, key: "row_1", start: 160 },
  ]),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  useVirtualizer: vi.fn(),
}))

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: virtualizerMocks.useVirtualizer,
}))

import { useChatMessageListWorkflow } from "./chat-message-list-workflow"

describe("useChatMessageListWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    virtualizerMocks.getTotalSize.mockReturnValue(320)
    virtualizerMocks.getVirtualItems.mockReturnValue([
      { index: 0, key: "row_0", start: 0 },
      { index: 1, key: "row_1", start: 160 },
    ])
    virtualizerMocks.useVirtualizer.mockReturnValue({
      getTotalSize: virtualizerMocks.getTotalSize,
      getVirtualItems: virtualizerMocks.getVirtualItems,
      measureElement: virtualizerMocks.measureElement,
      scrollToIndex: virtualizerMocks.scrollToIndex,
    })
  })

  it("adds a thinking row after existing messages while sending", async () => {
    const messages = [makeMessage({ id: "message_1" })]

    const { result } = renderHook(() =>
      useChatMessageListWorkflow({ isSending: true, messages }),
    )

    expect(result.current.messageRowCount).toBe(2)
    expect(result.current.shouldShowThinkingProgress).toBe(true)
    expect(result.current.isThinkingVirtualItem({ index: 1 })).toBe(true)
    expect(result.current.getVirtualMessage({ index: 0 })).toEqual(messages[0])
    await waitFor(() => {
      expect(virtualizerMocks.scrollToIndex).toHaveBeenCalledWith(1, {
        align: "end",
      })
    })
  })

  it("does not add a thinking row or autoscroll for an empty conversation", () => {
    const { result } = renderHook(() =>
      useChatMessageListWorkflow({ isSending: true, messages: [] }),
    )

    expect(result.current.messageRowCount).toBe(0)
    expect(result.current.shouldShowThinkingProgress).toBe(false)
    expect(virtualizerMocks.scrollToIndex).not.toHaveBeenCalled()
  })
})

function makeMessage(
  overrides: Partial<ChatMessageView> = {},
): ChatMessageView {
  return {
    id: "message_1",
    role: "user",
    content: "What changed?",
    ...overrides,
  }
}
