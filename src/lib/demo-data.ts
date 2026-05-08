import type { ParsedChunkView, SourceView } from "./types";

/**
 * Static demo document that unauthenticated users see on first visit.
 * One source with a handful of content sections — enough to show the
 * product shape without needing auth or a real parse.
 */
export const DEMO_SOURCE: SourceView = {
  id: "demo-source-1",
  title: "Welcome to Knowhere Notebook",
  status: "ready",
  chunkCount: 3,
};

export const DEMO_CHUNKS: ParsedChunkView[] = [
  {
    chunkId: "demo-chunk-1",
    documentId: "demo-doc-1",
    sectionPath: "Introduction",
    type: "text",
    content:
      "Knowhere Notebook is your personal workspace for exploring documents with AI.\n\n" +
      "Upload a document and Notebook will parse it into content sections. " +
      "You can then ask questions about your document and get answers grounded " +
      "directly in the source material.",
    summary: "Introduction",
    keywords: ["notebook", "ai", "documents"],
    sourceTitle: "Welcome to Knowhere Notebook",
  },
  {
    chunkId: "demo-chunk-2",
    documentId: "demo-doc-1",
    sectionPath: "How it works",
    type: "text",
    content:
      "1. Upload a PDF, DOCX, Markdown, or text file.\n" +
      "2. Notebook sends your document to Knowhere for parsing.\n" +
      "3. Browse the parsed content sections.\n" +
      "4. Ask questions — Notebook searches your document and generates answers with citations.",
    summary: "How it works",
    keywords: ["parsing", "retrieval", "citations"],
    sourceTitle: "Welcome to Knowhere Notebook",
  },
  {
    chunkId: "demo-chunk-3",
    documentId: "demo-doc-1",
    sectionPath: "Getting started",
    type: "text",
    content:
      "To get started, sign in with your Knowhere account.\n\n" +
      "Click the \"Log in to start\" button or use the upload and chat controls — " +
      "Notebook will guide you to the Knowhere Dashboard login page.\n\n" +
      "After signing in you can upload your own documents and ask questions.",
    summary: "Getting started",
    keywords: ["login", "getting started"],
    sourceTitle: "Welcome to Knowhere Notebook",
  },
];
