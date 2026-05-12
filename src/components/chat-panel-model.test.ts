import { describe, expect, it } from "vitest";

import { chatPanelModel } from "./chat-panel-model";

describe("chatPanelModel", () => {
  it("uses Notebook source titles instead of generated Knowhere file names", () => {
    const label = chatPanelModel.getCitationLabel(
      {
        chunkType: "text",
        score: 0.9,
        description: "document-CFxAaNTRUliEnWOokpI66xfj7JJkad.pdf",
        source: {
          documentId: "doc_1",
          sourceFileName: "document-CFxAaNTRUliEnWOokpI66xfj7JJkad.pdf",
          sectionPath: "Root",
        },
      },
      { doc_1: "TSLA-Q4-2025-Update.pdf" },
    );

    expect(label).toBe("TSLA-Q4-2025-Update.pdf");
  });

  it("keeps useful citation section detail while removing duplicate root labels", () => {
    const label = chatPanelModel.getCitationLabel(
      {
        chunkType: "text",
        score: 0.8,
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Default_Root/Risk Factors",
        },
      },
      {},
    );

    expect(label).toBe("report.pdf · Risk Factors");
  });

  it("formats invalid thread dates as recently updated", () => {
    expect(chatPanelModel.formatThreadDate("not-a-date")).toBe(
      "Updated recently",
    );
  });
});
