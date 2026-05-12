"use client"

import {
  useEffect,
  useRef,
  type RefObject,
} from "react"
import {
  useVirtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual"

import type { ChatMessageView } from "@/domains/chat/types"

type ChatVirtualItemInput = {
  readonly index: number
}

type ChatMessageListWorkflowInput = {
  readonly isSending: boolean
  readonly messages: readonly ChatMessageView[]
}

type ChatMessageListWorkflow = {
  readonly getVirtualMessage: (
    virtualItem: ChatVirtualItemInput,
  ) => ChatMessageView | undefined
  readonly isThinkingVirtualItem: (virtualItem: ChatVirtualItemInput) => boolean
  readonly measureElement: (node: HTMLDivElement | null) => void
  readonly messageRowCount: number
  readonly shouldShowThinkingProgress: boolean
  readonly totalHeight: number
  readonly viewportRef: RefObject<HTMLDivElement | null>
  readonly virtualItems: readonly VirtualItem[]
}

const estimatedMessageHeight = 160
const virtualMessageOverscan = 6

export function useChatMessageListWorkflow({
  isSending,
  messages,
}: ChatMessageListWorkflowInput): ChatMessageListWorkflow {
  const viewportRef = useRef<HTMLDivElement>(null)
  const shouldShowThinkingProgress = isSending && messages.length > 0
  const messageRowCount =
    messages.length + (shouldShowThinkingProgress ? 1 : 0)
  // TanStack Virtual owns scroll measurement callbacks; this hook is not memoized by React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const messageVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: messageRowCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => estimatedMessageHeight,
    overscan: virtualMessageOverscan,
  })
  const virtualItems = messageVirtualizer.getVirtualItems()
  const totalHeight = messageVirtualizer.getTotalSize()

  useEffect(() => {
    if (messageRowCount === 0) {
      return
    }

    messageVirtualizer.scrollToIndex(messageRowCount - 1, { align: "end" })
  }, [messageVirtualizer, messageRowCount])

  function isThinkingVirtualItem(virtualItem: ChatVirtualItemInput): boolean {
    return (
      shouldShowThinkingProgress &&
      virtualItem.index === messages.length
    )
  }

  function getVirtualMessage(
    virtualItem: ChatVirtualItemInput,
  ): ChatMessageView | undefined {
    return messages[virtualItem.index]
  }

  return {
    getVirtualMessage,
    isThinkingVirtualItem,
    measureElement: messageVirtualizer.measureElement,
    messageRowCount,
    shouldShowThinkingProgress,
    totalHeight,
    viewportRef,
    virtualItems,
  }
}
