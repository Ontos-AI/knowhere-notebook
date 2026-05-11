import type { ChatCitationView, ChatMessageView } from "./types";

/**
 * Static demo chat messages with citations that reference demo sources.
 *
 * Each citation's `source.documentId` matches a demo source definition
 * (see demo-data.ts).  The workspace shell's `handleCitationClick`
 * resolves the documentId against the loaded sources list, finds the
 * matching demo source, loads its chunks from the public directory, and
 * focuses the first text chunk.
 *
 * Clicking a citation chip in the guest demo should scroll to the
 * corresponding parsed content.
 */
export const DEMO_CHAT_MESSAGES: readonly ChatMessageView[] = [
  {
    id: "demo-user-1",
    role: "user",
    content: "What does the document say about Tesla's xAI investment?",
  },
  {
    id: "demo-asst-1",
    role: "assistant",
    content: [
      "Tesla entered an agreement on January 16, 2026 to invest approximately $2 billion in xAI Series E Preferred Stock.",
      "The document also says Tesla and xAI entered a framework agreement to evaluate AI collaboration, with the investment expected to close in Q1 2026 subject to customary regulatory conditions.",
    ].join("\n\n"),
    citations: [
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->OTHER UPDATES",
        description: "xAI investment",
        content: "On January 16, 2026, Tesla entered into an agreement to invest approximately $2 billion to acquire shares of Series E Preferred Stock of xAI.",
      }),
    ],
  },
  {
    id: "demo-user-2",
    role: "user",
    content: "What does the document say about energy storage?",
  },
  {
    id: "demo-asst-2",
    role: "assistant",
    content: [
      "Tesla achieved its highest quarterly energy storage deployments, driven by record Megapack deployments.",
      "Energy gross profit reached a record $1.1 billion, marking the fifth consecutive record quarter.",
      "Tesla also plans to begin Megapack 3 and Megablock production at Megafactory Houston in 2026.",
    ].join("\n\n"),
    citations: [
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->OPERATIONAL SUMMARY-->Energy generation and storage",
        description: "Storage deployment growth",
        content: "We achieved our highest quarterly energy storage deployments, driven by record Megapack deployments.",
      }),
    ],
  },
  {
    id: "demo-user-3",
    role: "user",
    content: "What production plans does Tesla mention for 2026?",
  },
  {
    id: "demo-asst-3",
    role: "assistant",
    content: [
      "Tesla says Cybercab, Tesla Semi, and Megapack 3 are on schedule for volume production starting in 2026.",
      "The same product update also notes that first-generation Optimus production lines are being installed before volume production.",
    ].join("\n\n"),
    citations: [
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->Product",
        description: "2026 production plans",
        content: "Cybercab, Tesla Semi and Megapack 3 are on schedule for volume production starting in 2026.",
      }),
    ],
  },
];

function makeCitation(
  documentId: string,
  overrides: {
    sourceFileName: string;
    sectionPath: string;
    description: string;
    content: string;
  },
): ChatCitationView {
  return {
    chunkType: "text",
    score: 0.95,
    content: overrides.content,
    description: overrides.description,
    assetUrl: undefined,
    source: {
      documentId,
      sourceFileName: overrides.sourceFileName,
      sectionPath: overrides.sectionPath,
    },
  };
}
