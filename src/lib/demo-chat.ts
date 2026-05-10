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
    content: "What were the key financial highlights from Tesla's latest quarter?",
  },
  {
    id: "demo-asst-1",
    role: "assistant",
    content: [
      "Tesla reported record quarterly revenue of $29.1 billion, up 12% year-over-year.",
      "Automotive gross margin reached 19.8%, driven by lower battery costs and manufacturing efficiencies.",
      "Cash and investments stood at $38.6 billion, providing a strong liquidity position.",
    ].join("\n\n"),
    citations: [
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Financial Highlights",
        description: "Q4 2025 financial summary",
        content: "Tesla reported record quarterly revenue of $29.1 billion, up 12% year-over-year.",
      }),
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Automotive Margins",
        description: "Margin breakdown",
        content: "Automotive gross margin reached 19.8%, driven by lower battery costs.",
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
      "Energy storage deployments grew 104% year-over-year to 14.7 GWh.",
      "Megapack factory in Lathrop is now producing at an annualized rate of 40 GWh.",
      "The energy business is becoming a meaningful contributor to Tesla's overall revenue mix.",
    ].join("\n\n"),
    citations: [
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Energy Storage",
        description: "Storage deployment growth",
        content: "Energy storage deployments grew 104% year-over-year to 14.7 GWh.",
      }),
    ],
  },
  {
    id: "demo-user-3",
    role: "user",
    content: "Are there any manufacturing updates?",
  },
  {
    id: "demo-asst-3",
    role: "assistant",
    content: [
      "Giga Texas produced its 1 millionth vehicle in Q4, marking a major manufacturing milestone.",
      "Cybertruck production continues to ramp, with over 50,000 units delivered in the quarter.",
      "The next-generation platform remains on track for volume production in H2 2026.",
    ].join("\n\n"),
    citations: [
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Manufacturing",
        description: "Giga Texas milestone",
        content: "Giga Texas produced its 1 millionth vehicle in Q4.",
      }),
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "New Products",
        description: "Cybertruck production",
        content: "Cybertruck production continues to ramp, with over 50,000 units delivered.",
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
