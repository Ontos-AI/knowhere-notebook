import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { loadWorkspaceShellInitialState } from "./initial-state";
import type { AuthUser } from "@/infrastructure/auth";
import type { ChatThread, Source, Workspace } from "@/infrastructure/db/schema";

type InitialStateDependencies = NonNullable<
  Parameters<typeof loadWorkspaceShellInitialState>[0]
>;
type InitialStateClient = Awaited<
  ReturnType<InitialStateDependencies["getClientForWorkspace"]>
>["client"];

describe("loadWorkspaceShellInitialState", () => {
  it("returns static guest state without touching workspace persistence", async () => {
    const deps = createDependencies({
      getOptionalAuthenticated: vi.fn(async () => null),
    });

    const state = await loadWorkspaceShellInitialState(deps);

    expect(state.isGuest).toBe(true);
    expect(state.sources).toEqual([
      {
        id: "demo_source_1",
        title: "Demo.pdf",
        mimeType: "application/pdf",
        status: "ready",
      },
    ]);
    expect(state.chatMessages).toEqual([
      {
        id: "demo_message_1",
        role: "assistant",
        content: "Demo answer",
      },
    ]);
    expect(state.loginUrl).toBe("/login");
    expect(deps.ensureDemoWorkspaceContent).not.toHaveBeenCalled();
  });

  it("seeds demo workspace content before loading authenticated shell data", async () => {
    const workspace = makeWorkspace();
    const source = makeSource(workspace.id);
    const thread = makeThread(workspace.id);
    const callOrder: string[] = [];
    const deps = createDependencies({
      ensureDemoWorkspaceContent: vi.fn(async () => {
        callOrder.push("seed");
      }),
      listChatThreads: vi.fn(async () => {
        callOrder.push("threads");
        return [thread];
      }),
      reconcileSourcesForWorkspace: vi.fn(async () => {
        callOrder.push("sources");
        return [source];
      }),
      sourceViewOptionsBySourceId: vi.fn(() =>
        Effect.succeed(new Map([[source.id, { chunkCount: 2 }]])),
      ),
    });

    const state = await loadWorkspaceShellInitialState(deps);

    expect(callOrder[0]).toBe("seed");
    expect(state.isGuest).toBeUndefined();
    expect(state.activeChatThreadId).toBe(thread.id);
    expect(state.sources).toEqual([
      {
        id: source.id,
        title: "notes.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "document_1",
        chunkCount: 2,
      },
    ]);
  });

  it("reconciles source state during authenticated shell load", async () => {
    const workspace = makeWorkspace();
    const readySource = makeSource(workspace.id, {
      status: "ready",
      knowhereDocumentId: "document_1",
    });
    const reconcileSourcesForWorkspace = vi.fn(async () => [readySource]);
    const deps = {
      ...createDependencies({
        getOptionalAuthenticated: vi.fn(async () => ({
          user: {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada",
          },
          workspace,
        })),
      }),
      reconcileSourcesForWorkspace,
    } satisfies InitialStateDependencies;

    const state = await loadWorkspaceShellInitialState(deps);

    expect(reconcileSourcesForWorkspace).toHaveBeenCalledWith(
      workspace,
      expect.any(Object),
    );
    expect(state.sources).toEqual([
      {
        id: readySource.id,
        title: "notes.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "document_1",
      },
    ]);
  });
});

function createDependencies(
  overrides: Partial<InitialStateDependencies> = {},
): InitialStateDependencies {
  const workspace = makeWorkspace();
  const user: AuthUser = {
    id: "user_1",
    email: "ada@example.com",
    name: "Ada",
  };
  const client = {} as InitialStateClient;

  return {
    demoChatMessages: [
      {
        id: "demo_message_1",
        role: "assistant",
        content: "Demo answer",
      },
    ],
    demoSources: [
      {
        id: "demo_source_1",
        title: "Demo.pdf",
        mimeType: "application/pdf",
        status: "ready",
      },
    ],
    ensureDemoWorkspaceContent: vi.fn(async () => undefined),
    getClientForWorkspace: vi.fn(async () => ({ client })),
    getGuest: vi.fn(async () => ({ loginUrl: "/login" })),
    getOptionalAuthenticated: vi.fn(async () => ({ user, workspace })),
    listChatThreads: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    reconcileSourcesForWorkspace: vi.fn(async () => []),
    sourceViewOptionsBySourceId: vi.fn(() => Effect.succeed(new Map())),
    ...overrides,
  };
}

function makeWorkspace(): Workspace {
  return {
    id: "workspace_1",
    userId: "user_1",
    namespace: "notebook-workspace_1",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
  };
}

function makeSource(
  workspaceId: string,
  overrides: Partial<Source> = {},
): Source {
  return {
    id: "source_1",
    workspaceId,
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_1",
    knowhereDocumentId: "document_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function makeThread(workspaceId: string): ChatThread {
  return {
    id: "thread_1",
    workspaceId,
    demoKey: null,
    title: "Revenue",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
  };
}
