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
      "Tesla reported quarterly revenue of $24.9 billion, down 3% year-over-year.",
      "Quarterly operating income was $1.4 billion, with a 5.7% operating margin.",
      "Cash, cash equivalents, and investments ended the quarter at $44.1 billion.",
    ].join("\n\n"),
    citations: [
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->GIGAFACTORY NEVADA - 6 MILLIONTH DRIVE UNIT PRODUCED-->Revenue",
        description: "Q4 revenue",
        content: "Total quarterly revenue decreased $3 \\%$ YoY to $\\$ 24.9$ B.",
      }),
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->GIGAFACTORY NEVADA - 6 MILLIONTH DRIVE UNIT PRODUCED-->Profitability",
        description: "Operating income",
        content: "Our quarterly operating income decreased $11 \\%$ YoY to $\\$ 1.4$ B, resulting in a $5.7 \\%$ operating margin.",
      }),
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->Cash",
        description: "Cash position",
        content: "Quarter-end cash, cash equivalents and investments was $44.1B.",
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
    content: "Are there any manufacturing updates?",
  },
  {
    id: "demo-asst-3",
    role: "assistant",
    content: [
      "The document highlights a Gigafactory Shanghai milestone for Tesla's 9 millionth vehicle produced globally.",
      "It also shows Gigafactory Nevada celebrating its 6 millionth drive unit produced.",
      "For robotics, Tesla says preparations are underway for the first Optimus production line, with start of production planned before the end of 2026.",
    ].join("\n\n"),
    citations: [
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->Product-->GIGAFACTORY SHANGHAI - 9 MILLIONTH VEHICLE PRODUCED (GLOBALLY)",
        description: "Shanghai vehicle milestone",
        content: "A large group of people, many wearing safety vests and hard hats, are gathered in a factory setting for a group photo.",
      }),
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->GIGAFACTORY NEVADA - 6 MILLIONTH DRIVE UNIT PRODUCED",
        description: "Nevada drive unit milestone",
        content: "A large group of people is gathered inside a factory, holding large golden balloons that spell out \"6000000.\"",
      }),
      makeCitation("demo-doc-tsla-q4-2025", {
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Default_Root/TSLA-Q4-2025-Update.pdf-->OPERATIONAL SUMMARY-->Robotics",
        description: "Optimus production line",
        content: "Preparations are underway for the first production line, including supply chain readiness, with start of production planned before the end of 2026.",
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
