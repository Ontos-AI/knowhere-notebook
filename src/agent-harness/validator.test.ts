import { describe, expect, it } from "vitest"

import { validateOutputManifest } from "./validator"
import type {
  ContextPolicy,
  EvidenceLedgerSnapshot,
  IntentFrame,
  OutputManifest,
} from "./types"

describe("validateOutputManifest", () => {
  it("requires the agent to declare intent and context policy before finalizing", () => {
    const validation = validateOutputManifest({
      manifest: makeManifest({ text: "Answer." }),
      ledger: emptyLedger,
      surface: "notebook_chat",
    })

    expect(validation.errors).toContain(
      "Agent must declare intent before finalizing.",
    )
    expect(validation.errors).toContain(
      "Agent must set context policy before finalizing.",
    )
  })

  it("limits displayed artifacts using the declared intent instead of hard-coded media rules", () => {
    const validation = validateOutputManifest({
      manifest: makeManifest({
        artifacts: [
          {
            type: "image",
            ref: "asset:r1:result:1",
            display: true,
            reason: "front",
          },
          {
            type: "image",
            ref: "asset:r1:result:2",
            display: true,
            reason: "back",
          },
          {
            type: "image",
            ref: "asset:r1:result:3",
            display: true,
            reason: "extra candidate",
          },
        ],
      }),
      intent: makeIntent({ desiredCount: 2, maxCount: 2 }),
      contextPolicy: unrelatedContextPolicy,
      ledger: {
        ...emptyLedger,
        assets: [
          makeAsset("asset:r1:result:1"),
          makeAsset("asset:r1:result:2"),
          makeAsset("asset:r1:result:3"),
        ],
      },
      surface: "notebook_chat",
    })

    expect(validation.errors).toContain(
      "Displayed artifact count 3 exceeds desired count 2.",
    )
    expect(validation.errors).toContain(
      "Displayed artifact count 3 exceeds maximum count 2.",
    )
  })

  it("rejects grounded answers that use evidence without citations or selected artifacts", () => {
    const validation = validateOutputManifest({
      manifest: makeManifest({ text: "Revenue increased." }),
      intent: makeIntent({}),
      contextPolicy: unrelatedContextPolicy,
      ledger: {
        ...emptyLedger,
        chunks: [
          {
            ref: "r1:result:1",
            kind: "result",
            content: "Revenue increased.",
            contentPreview: "Revenue increased.",
            chunkType: "text",
            score: 0.9,
            source: {
              documentId: "doc_1",
              sourceFileName: "report.pdf",
              sectionPath: "Q4",
            },
          },
        ],
      },
      surface: "notebook_chat",
    })

    expect(validation.errors).toContain(
      "Grounded output used evidence but did not cite or display any selected evidence.",
    )
  })

  it("keeps typing compose output insertion-ready", () => {
    const validation = validateOutputManifest({
      manifest: makeManifest({ text: "- bullet\n- list" }),
      intent: makeIntent({ groundingPolicy: "no_retrieval" }),
      contextPolicy: unrelatedContextPolicy,
      ledger: emptyLedger,
      surface: "typing_compose",
    })

    expect(validation.errors).toContain(
      "Typing compose output must be insertion-ready plain text.",
    )
  })
})

const emptyLedger: EvidenceLedgerSnapshot = {
  retrievalCount: 0,
  chunks: [],
  assets: [],
  evidenceText: [],
  stopReasons: [],
  failureReasons: [],
  decisionTraces: [],
}

const unrelatedContextPolicy: ContextPolicy = {
  carryHistory: "none",
  reason: "The current turn is self-contained.",
  activePriorTurnIds: [],
}

function makeIntent(
  constraints: IntentFrame["constraints"] & {
    readonly groundingPolicy?: IntentFrame["groundingPolicy"]
  },
): IntentFrame {
  return {
    task: "answer",
    dependsOnPreviousTurn: false,
    retrievalNeeded: constraints.groundingPolicy === "no_retrieval" ? "no" : "yes",
    targetModalities: ["text"],
    constraints,
    groundingPolicy: constraints.groundingPolicy ?? "must_use_sources",
  }
}

function makeManifest(overrides: Partial<OutputManifest>): OutputManifest {
  return {
    text: "",
    citations: [],
    artifacts: [],
    unresolved: [],
    ...overrides,
  }
}

function makeAsset(ref: string): EvidenceLedgerSnapshot["assets"][number] {
  return {
    ref,
    chunkRef: ref.replace("asset:", ""),
    type: "image",
    assetUrl: `https://assets.example/${ref}.png`,
    label: ref,
    source: {
      documentId: "doc_1",
      sourceFileName: "report.pdf",
      sectionPath: ref,
    },
  }
}
