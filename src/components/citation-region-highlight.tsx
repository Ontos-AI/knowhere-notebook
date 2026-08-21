import type { ReactNode } from "react"

import type { ChatImageHighlightBox } from "@/domains/chat/types"

export function CitationRegionHighlight({
  regions,
  requestId,
}: {
  readonly regions: readonly ChatImageHighlightBox[]
  readonly requestId: number
}): ReactNode {
  if (regions.length === 0) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      data-testid="citation-region-highlights"
    >
      {regions.map((region, index) => (
        <span
          key={`${requestId}:${index}`}
          data-testid="citation-region-highlight"
          className="citation-region-flash absolute box-border"
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.w * 100}%`,
            height: `${region.h * 100}%`,
          }}
        />
      ))}
    </div>
  )
}
