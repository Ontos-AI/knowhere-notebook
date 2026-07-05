import { describe, expect, it } from "vitest"

import { parsedDocumentSyncCapacityGuard } from "./parsed-document-sync-capacity"

describe("parsedDocumentSyncCapacityGuard", () => {
  it("uses the configured defaults when environment variables are absent", () => {
    expect(parsedDocumentSyncCapacityGuard.readPolicy({})).toEqual({
      globalActiveLimit: 100,
      workspaceActiveLimit: 5,
      documentActiveLimit: 1,
      waitSeconds: 60,
    })
  })

  it("reads positive integer capacity settings from the environment", () => {
    expect(
      parsedDocumentSyncCapacityGuard.readPolicy({
        SYNC_GLOBAL_ACTIVE_LIMIT: "12",
        SYNC_WORKSPACE_ACTIVE_LIMIT: "3",
        SYNC_DOCUMENT_ACTIVE_LIMIT: "2",
        SYNC_WAIT_SECONDS: "90",
      }),
    ).toEqual({
      globalActiveLimit: 12,
      workspaceActiveLimit: 3,
      documentActiveLimit: 2,
      waitSeconds: 90,
    })
  })

  it("denies capacity by document, workspace, then global cap", () => {
    const policy = parsedDocumentSyncCapacityGuard.readPolicy({})

    expect(
      parsedDocumentSyncCapacityGuard.selectDenialReason(
        { globalActive: 0, workspaceActive: 0, documentActive: 1 },
        policy,
      ),
    ).toBe("document")
    expect(
      parsedDocumentSyncCapacityGuard.selectDenialReason(
        { globalActive: 0, workspaceActive: 5, documentActive: 0 },
        policy,
      ),
    ).toBe("workspace")
    expect(
      parsedDocumentSyncCapacityGuard.selectDenialReason(
        { globalActive: 100, workspaceActive: 0, documentActive: 0 },
        policy,
      ),
    ).toBe("global")
  })
})
