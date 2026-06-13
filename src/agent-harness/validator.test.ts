import { describe, expect, it } from "vitest"

import { validateOutputManifest } from "./validator"
import type {
  ContextPolicy,
  EvidenceLedgerSnapshot,
  IntentFrame,
  OutputManifest,
} from "./types"

describe("validateOutputManifest", () => {
  it("requires finalize to be the successful output path", () => {
    const validation = validateOutputManifest({
      manifest: makeManifest({ text: "Freeform answer." }),
      intent: makeIntent({ groundingPolicy: "no_retrieval" }),
      contextPolicy: unrelatedContextPolicy,
      finalized: false,
      ledger: emptyLedger,
      surface: "notebook_chat",
    })

    expect(validation.errors).toContain(
      "Agent must call finalize to produce the output manifest.",
    )
  })

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

  it("accepts source-backed derived tables and rejects missing source refs", () => {
    const validation = validateOutputManifest({
      manifest: makeManifest({
        artifacts: [
          {
            type: "derived_table",
            ref: "derived:table:1",
            title: "Revenue comparison",
            columns: ["Metric", "Value"],
            rows: [["Revenue", "$10M"]],
            sourceRefs: ["r1:result:1"],
            display: true,
            reason: "Structured comparison requested by the user.",
          },
          {
            type: "derived_table",
            ref: "derived:table:2",
            title: "Invalid table",
            columns: ["Metric", "Value"],
            rows: [["Revenue"]],
            sourceRefs: ["missing"],
            display: true,
            reason: "Demonstrates validation.",
          },
        ],
      }),
      intent: makeIntent({}),
      contextPolicy: unrelatedContextPolicy,
      ledger: {
        ...emptyLedger,
        chunks: [
          {
            ref: "r1:result:1",
            kind: "result",
            content: "Revenue was $10M.",
            contentPreview: "Revenue was $10M.",
            chunkType: "text",
            score: 0.9,
            source: {
              documentId: "doc_1",
              sourceFileName: "report.pdf",
              sectionPath: "Revenue",
            },
          },
        ],
      },
      surface: "notebook_chat",
    })

    expect(validation.errors).toContain(
      "Derived table source ref 'missing' was not found in the evidence ledger.",
    )
    expect(validation.errors).toContain(
      "Derived table row 1 has 1 cells but expected 2.",
    )
  })

  it("requires compare outputs to cite at least two evidence refs", () => {
    const validation = validateOutputManifest({
      manifest: makeManifest({
        text: "A is stronger than B.",
        citations: [
          {
            ref: "r1:result:1",
            label: "report.pdf / A",
            source: {
              documentId: "doc_1",
              sourceFileName: "report.pdf",
              sectionPath: "A",
            },
          },
        ],
      }),
      intent: {
        ...makeIntent({}),
        task: "compare",
      },
      contextPolicy: unrelatedContextPolicy,
      ledger: {
        ...emptyLedger,
        chunks: [
          {
            ref: "r1:result:1",
            kind: "result",
            content: "A is strong.",
            contentPreview: "A is strong.",
            chunkType: "text",
            score: 0.9,
            source: {
              documentId: "doc_1",
              sourceFileName: "report.pdf",
              sectionPath: "A",
            },
          },
        ],
      },
      surface: "notebook_chat",
    })

    expect(validation.errors).toContain(
      "Compare outputs that must use sources require at least two evidence refs or an explicit unresolved reason.",
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
