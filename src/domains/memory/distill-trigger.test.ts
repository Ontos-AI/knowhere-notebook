import { afterEach, describe, expect, it, vi } from "vitest"

import { DISTILL_COOLDOWN_MS, DISTILL_MIN_PENDING } from "./distill-config"

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  trigger: vi.fn(),
  countPendingObservations: vi.fn(),
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

vi.mock("./service", () => ({
  memoryService: {
    countPendingObservations: mocks.countPendingObservations,
  },
}))

describe("triggerMemoryDistill", () => {
  afterEach(async () => {
    vi.clearAllMocks()
    vi.useRealTimers()
    delete process.env.QSTASH_TOKEN
    delete process.env.NOTEBOOK_PUBLIC_URL
    const { resetMemoryDistillTriggerStateForTests } = await import(
      "./distill-trigger"
    )
    resetMemoryDistillTriggerStateForTests()
    vi.resetModules()
  })

  it("does not trigger when pending is below the plan threshold", async () => {
    mocks.countPendingObservations.mockResolvedValue(DISTILL_MIN_PENDING - 1)
    process.env.QSTASH_TOKEN = "qstash_token"

    const { triggerMemoryDistill } = await import("./distill-trigger")
    await triggerMemoryDistill({ workspaceId: "workspace_1" })

    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it("deduplicates workflow triggers only within a bounded cooldown", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-30T00:00:00.000Z"))
    process.env.QSTASH_TOKEN = "qstash_token"
    process.env.NOTEBOOK_PUBLIC_URL = "https://notebook.example"
    mocks.countPendingObservations.mockResolvedValue(DISTILL_MIN_PENDING)
    mocks.trigger.mockResolvedValue({})

    const { triggerMemoryDistill } = await import("./distill-trigger")

    await triggerMemoryDistill({ workspaceId: "workspace_1" })
    await triggerMemoryDistill({ workspaceId: "workspace_1" })

    expect(mocks.trigger).toHaveBeenCalledTimes(1)
    expect(mocks.trigger).toHaveBeenLastCalledWith({
      url: "https://notebook.example/api/memory/distill",
      body: { workspaceId: "workspace_1" },
      workflowRunId: `workspace_1-${Math.floor(
        new Date("2026-06-30T00:00:00.000Z").getTime() / DISTILL_COOLDOWN_MS,
      )}`,
      retries: 3,
    })

    vi.setSystemTime(new Date("2026-06-30T00:05:01.000Z"))
    await triggerMemoryDistill({ workspaceId: "workspace_1" })

    expect(mocks.trigger).toHaveBeenCalledTimes(2)
  })
})
