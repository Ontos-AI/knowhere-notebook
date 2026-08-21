import { describe, expect, it } from "vitest"

import {
  mergeImageInspectionHighlights,
  normalizeHighlightBoxes,
  normalizeImageInspectionHighlights,
} from "./image-highlights"

describe("image highlights", () => {
  it("normalizes multi-page multi-region boxes and drops invalid refs", () => {
    const highlights = normalizeImageInspectionHighlights({
      allowedRefs: new Set(["asset:page-1", "asset:page-2"]),
      pages: [
        {
          ref: "asset:page-1",
          regions: [
            { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
            { x: 0.5, y: 0.6, w: 0.2, h: 0.15 },
          ],
        },
        {
          ref: "asset:page-2",
          regions: [{ x: -0.1, y: 0.9, w: 0.3, h: 0.2 }],
        },
        {
          ref: "asset:unknown",
          regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
        },
      ],
    })

    expect(highlights).toEqual([
      {
        ref: "asset:page-1",
        regions: [
          { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
          { x: 0.5, y: 0.6, w: 0.2, h: 0.15 },
        ],
      },
      {
        ref: "asset:page-2",
        regions: [{ x: 0, y: 0.9, w: 0.2, h: 0.1 }],
      },
    ])
  })

  it("clamps standalone highlight boxes for persistence reload", () => {
    expect(
      normalizeHighlightBoxes([
        { x: -0.2, y: 0.5, w: 0.4, h: 0.2 },
        { x: 0.1, y: 0.1, w: 0.001, h: 0.2 },
      ]),
    ).toEqual([{ x: 0, y: 0.5, w: 0.2, h: 0.2 }])
  })

  it("replaces prior regions for the same ref on later inspects", () => {
    expect(
      mergeImageInspectionHighlights(
        [
          {
            ref: "asset:page-1",
            regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
          },
        ],
        [
          {
            ref: "asset:page-1",
            regions: [
              { x: 0.2, y: 0.3, w: 0.1, h: 0.1 },
              { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            ],
          },
          {
            ref: "asset:page-3",
            regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
          },
        ],
      ),
    ).toEqual([
      {
        ref: "asset:page-1",
        regions: [
          { x: 0.2, y: 0.3, w: 0.1, h: 0.1 },
          { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
        ],
      },
      {
        ref: "asset:page-3",
        regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
      },
    ])
  })
})
