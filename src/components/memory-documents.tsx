"use client"

import { useEffect, useState } from "react"
import type { ReactElement } from "react"

type MemoryArea = {
  readonly id: string
  readonly title: string
  readonly summaryStatus: "current" | "pending"
}

type MemoryMember = {
  readonly itemId: string
  readonly kind: string
  readonly status: string
  readonly text: string
}

type MemoryDocument = {
  readonly id: string
  readonly title: string
  readonly summaryStatus: "current" | "pending"
  readonly summary: string | null
  readonly members: readonly MemoryMember[]
}

export function MemoryDocuments(props: {
  readonly onBack: () => void
}): ReactElement {
  const [areas, setAreas] = useState<readonly MemoryArea[]>([])
  const [document, setDocument] = useState<MemoryDocument | null>(null)

  useEffect(() => {
    void fetch("/api/memory-areas")
      .then((response) => response.json())
      .then((body: { areas?: readonly MemoryArea[] }) => {
        setAreas(body.areas ?? [])
      })
  }, [])

  async function openArea(areaId: string): Promise<void> {
    const response = await fetch(`/api/memory-areas/${areaId}`)
    setDocument((await response.json()) as MemoryDocument)
  }

  async function deleteItem(itemId: string): Promise<void> {
    if (!document) return
    await fetch(`/api/memory-items/${itemId}`, { method: "DELETE" })
    await openArea(document.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button type="button" onClick={props.onBack}>
          Back
        </button>
        <h2 className="text-sm font-semibold">
          {document?.title ?? "MEMORY.MD"}
        </h2>
      </div>
      {document ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {document.summaryStatus === "current" && document.summary ? (
            <p className="mb-4 text-sm">{document.summary}</p>
          ) : null}
          <ul className="flex flex-col gap-4">
            {document.members.map((member) => (
              <li key={member.itemId}>
                <p className="text-xs text-muted-foreground">
                  {member.kind} {member.status}
                </p>
                <p className="text-sm">{member.text}</p>
                <button type="button" onClick={() => void deleteItem(member.itemId)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {areas.map((area) => (
            <li key={area.id}>
              <button type="button" onClick={() => void openArea(area.id)}>
                {area.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
