import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  trigger: vi.fn(),
}))

vi.mock("@upstash/workflow", () => ({
  Client: class {
    trigger = mocks.trigger
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}))

describe("startBackgroundReconciliation", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    delete process.env.QSTASH_TOKEN
    delete process.env.NOTEBOOK_PUBLIC_URL
    vi.resetModules()
  })

  it("deduplicates workflow triggers only within a bounded cooldown", async () => {
    const triggerCooldownMs: number = 5 * 60_000
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-30T00:00:00.000Z"))
    process.env.QSTASH_TOKEN = "qstash_token"
    process.env.NOTEBOOK_PUBLIC_URL = "https://notebook.example"
    mocks.trigger.mockResolvedValue({})

    const { startBackgroundReconciliation } = await import(
      "./background-reconcile"
    )

    await startBackgroundReconciliation(
      "workspace_1",
      "source_1",
      "knowhere_key",
    )
    await startBackgroundReconciliation(
      "workspace_1",
      "source_1",
      "knowhere_key",
    )

    expect(mocks.trigger).toHaveBeenCalledTimes(1)
    expect(mocks.trigger).toHaveBeenLastCalledWith({
      url: "https://notebook.example/api/sources/reconcile",
      body: {
        workspaceId: "workspace_1",
        sourceId: "source_1",
        apiKey: "knowhere_key",
      },
      workflowRunId: `source_1-${Math.floor(
        new Date("2026-06-30T00:00:00.000Z").getTime() / triggerCooldownMs,
      )}`,
      retries: 3,
    })

    vi.setSystemTime(new Date("2026-06-30T00:05:01.000Z"))
    await startBackgroundReconciliation(
      "workspace_1",
      "source_1",
      "knowhere_key",
    )

    expect(mocks.trigger).toHaveBeenCalledTimes(2)
    expect(mocks.trigger).toHaveBeenLastCalledWith({
      url: "https://notebook.example/api/sources/reconcile",
      body: {
        workspaceId: "workspace_1",
        sourceId: "source_1",
        apiKey: "knowhere_key",
      },
      workflowRunId: `source_1-${Math.floor(
        new Date("2026-06-30T00:05:01.000Z").getTime() / triggerCooldownMs,
      )}`,
      retries: 3,
    })
  })
})
