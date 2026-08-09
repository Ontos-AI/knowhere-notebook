import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "@/infrastructure/db/schema";
import {
  chatMessages,
  chatThreads,
  sourceParseResults,
  sources,
  workspaces,
} from "@/infrastructure/db/schema";

/**
 * Integration tests for the soft-delete and workspace-scoping helpers.
 *
 * These run against a real Postgres — skipped entirely unless
 * `TEST_DATABASE_URL` is set. Local dev gets that from the Docker
 * container (`postgres://postgres:postgres@127.0.0.1:55432/
 * knowhere_notebook_e2e`). CI leaves it unset so these tests are
 * no-ops there.
 *
 * The file uses `vi.doMock("./db", ...)` indirectly via process.env
 * so the real `workspace.ts` runs against the test DB.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("workspace helpers — integration", () => {
  // Use a separate test client bound to the test DB. The production
  // `db.ts` uses the live DATABASE_URL; here we want explicit control.
  // We load `./workspace` after setting env so the module picks up the
  // right client.

  let testDb: ReturnType<typeof drizzle<typeof schema>>;
  let testClient: ReturnType<typeof postgres>;
  let workspaceHelpers: {
    readonly ensureWorkspace: (userId: string) => Promise<schema.Workspace>
    readonly findSourceInWorkspace: (
      workspaceId: string,
      sourceId: string,
    ) => Promise<schema.Source | null>
    readonly softDeleteSource: (
      workspaceId: string,
      sourceId: string,
    ) => Promise<boolean>
    readonly appendMessageToThread: (
      workspaceId: string,
      input: Parameters<
        typeof import("../chat/thread-service").chatThreadService.appendMessage
      >[1],
    ) => Promise<schema.ChatMessage | null>
    readonly ensureDefaultChatThread: (
      workspaceId: string,
    ) => Promise<schema.ChatThread>
    readonly listMessagesForThread: (
      workspaceId: string,
      threadId: string,
    ) => Promise<schema.ChatMessage[] | null>
    readonly softDeleteChatThread: (
      workspaceId: string,
      threadId: string,
    ) => Promise<boolean>
    readonly createUploadingSource: (
      workspaceId: string,
      input: Parameters<
        typeof import("../sources/workflow-runtime").sourceWorkflowRuntime.createUploading
      >[1],
    ) => Promise<schema.Source>
    readonly listSourcesForWorkspace: (
      workspaceId: string,
    ) => Promise<schema.Source[]>
    readonly markSourceParsing: (
      workspaceId: string,
      sourceId: string,
      jobId: string,
    ) => Promise<schema.Source | null>
    readonly markSourceReady: (
      workspaceId: string,
      sourceId: string,
      documentId: string,
    ) => Promise<schema.Source | null>
    readonly markSourceFailed: (
      workspaceId: string,
      sourceId: string,
      reason: string,
    ) => Promise<schema.Source | null>
    readonly saveSourceParseResult: (
      workspaceId: string,
      sourceId: string,
      input: Parameters<
        typeof import("../sources/workflow-runtime").sourceWorkflowRuntime.saveParseResult
      >[2],
    ) => Promise<schema.SourceParseResult | null>
    readonly getParseAssetUrls: (
      workspaceId: string,
      sourceId: string,
    ) => Promise<Readonly<Record<string, string>>>
  };

  beforeEach(async () => {
    testClient = postgres(TEST_DATABASE_URL!, { prepare: false });
    testDb = drizzle(testClient, { schema });

    // Reset module cache and point the app `db` module at our test client.
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("./db", () => ({ db: testDb }));
    const [
      { workspaceService },
      { sourceService },
      { sourceWorkflowRuntime },
      { chatThreadService },
    ] = await Promise.all([
        import("./service"),
        import("../sources/service"),
        import("../sources/workflow-runtime"),
        import("../chat/thread-service"),
      ]);
    workspaceHelpers = {
      ensureWorkspace: async (userId: string) => {
        const row = await workspaceService.ensureWorkspaceForNamespace(
          userId,
          `ns-${userId}`,
        )
        return row
      },
      findSourceInWorkspace: sourceService.findInWorkspace,
      softDeleteSource: sourceService.softDelete,
      appendMessageToThread: chatThreadService.appendMessage,
      ensureDefaultChatThread: chatThreadService.ensureDefault,
      listMessagesForThread: chatThreadService.listMessages,
      softDeleteChatThread: chatThreadService.softDelete,
      createUploadingSource: sourceWorkflowRuntime.createUploading,
      listSourcesForWorkspace: sourceWorkflowRuntime.listForWorkspace,
      markSourceParsing: sourceWorkflowRuntime.markParsing,
      markSourceReady: sourceWorkflowRuntime.markReady,
      markSourceFailed: sourceWorkflowRuntime.markFailed,
      saveSourceParseResult: sourceWorkflowRuntime.saveParseResult,
      getParseAssetUrls: sourceService.getParseAssetUrls,
    };

    // Clean slate on the tables these tests touch. Order respects FK.
    await testDb.delete(chatMessages);
    await testDb.delete(chatThreads);
    await testDb.delete(sourceParseResults);
    await testDb.delete(sources);
    await testDb.delete(workspaces);
  });

  afterEach(async () => {
    await testClient.end();
  });

  it("findSourceInWorkspace returns null for wrong workspace", async () => {
    const ws1 = await workspaceHelpers.ensureWorkspace("user_1");
    await workspaceHelpers.ensureWorkspace("user_2");

    const [srcRow] = await testDb
      .insert(sources)
      .values({
        workspaceId: ws1.id,
        title: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "ready",
      })
      .returning();

    const ws2 = (await testDb
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, "user_2"))
      .limit(1))[0]!;

    const hit = await workspaceHelpers.findSourceInWorkspace(ws1.id, srcRow!.id);
    expect(hit?.title).toBe("doc.pdf");

    const miss = await workspaceHelpers.findSourceInWorkspace(ws2.id, srcRow!.id);
    expect(miss).toBeNull();
  });

  it("findSourceInWorkspace hides soft-deleted rows", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const [srcRow] = await testDb
      .insert(sources)
      .values({
        workspaceId: ws.id,
        title: "deleted.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "ready",
        deletedAt: new Date(),
      })
      .returning();

    const hit = await workspaceHelpers.findSourceInWorkspace(ws.id, srcRow!.id);
    expect(hit).toBeNull();
  });

  it("softDeleteSource writes deleted_at only when scope matches", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const otherWs = await workspaceHelpers.ensureWorkspace("user_2");

    const [srcRow] = await testDb
      .insert(sources)
      .values({
        workspaceId: ws.id,
        title: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "ready",
      })
      .returning();

    // Wrong workspace: no-op, returns false.
    const wrongOk = await workspaceHelpers.softDeleteSource(
      otherWs.id,
      srcRow!.id,
    );
    expect(wrongOk).toBe(false);

    const stillLive = await workspaceHelpers.findSourceInWorkspace(
      ws.id,
      srcRow!.id,
    );
    expect(stillLive?.deletedAt).toBeNull();

    // Correct workspace: soft-delete succeeds.
    const ok = await workspaceHelpers.softDeleteSource(ws.id, srcRow!.id);
    expect(ok).toBe(true);

    const nowHidden = await workspaceHelpers.findSourceInWorkspace(
      ws.id,
      srcRow!.id,
    );
    expect(nowHidden).toBeNull();

    // Second soft-delete is a no-op (already deleted), returns false.
    const again = await workspaceHelpers.softDeleteSource(ws.id, srcRow!.id);
    expect(again).toBe(false);
  });

  it("appendMessageToThread rejects cross-workspace thread ids", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const otherWs = await workspaceHelpers.ensureWorkspace("user_2");

    const [thread] = await testDb
      .insert(chatThreads)
      .values({ workspaceId: ws.id, title: "hello" })
      .returning();

    const ok = await workspaceHelpers.appendMessageToThread(ws.id, {
      threadId: thread!.id,
      role: "user",
      content: "hi",
    });
    expect(ok?.content).toBe("hi");

    const crossTenant = await workspaceHelpers.appendMessageToThread(
      otherWs.id,
      {
        threadId: thread!.id,
        role: "user",
        content: "should fail",
      },
    );
    expect(crossTenant).toBeNull();

    const rows = await testDb
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, thread!.id));
    expect(rows.length).toBe(1);
    expect(rows[0]!.content).toBe("hi");
  });

  it("appendMessageToThread bumps thread.updated_at", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const [thread] = await testDb
      .insert(chatThreads)
      .values({ workspaceId: ws.id, title: "bump me" })
      .returning();

    const originalUpdated = thread!.updatedAt;
    // Force a new monotonic timestamp since updated_at defaults to now()
    await new Promise((r) => setTimeout(r, 10));

    await workspaceHelpers.appendMessageToThread(ws.id, {
      threadId: thread!.id,
      role: "user",
      content: "touch",
    });

    const [reloaded] = await testDb
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.id, thread!.id));
    expect(reloaded!.updatedAt.getTime()).toBeGreaterThan(
      originalUpdated.getTime(),
    );
  });

  it("appendMessageToThread strips retrieval content from persisted citations", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const [thread] = await testDb
      .insert(chatThreads)
      .values({ workspaceId: ws.id, title: "citations" })
      .returning();

    const inserted = await workspaceHelpers.appendMessageToThread(ws.id, {
      threadId: thread!.id,
      role: "assistant",
      content: "The answer is grounded.",
      citations: [
        {
          content: "source chunk text must never be persisted",
          chunkType: "text",
          score: 0.91,
          assetUrl: "https://assets.example/doc.pdf",
          description: "intro summary",
          source: {
            documentId: "doc_123",
            sourceFileName: "doc.pdf",
            sectionPath: "1. Introduction",
          },
        },
      ],
    });

    expect(inserted).not.toBeNull();

    const [message] = await testDb
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, inserted!.id));
    const [citation] = message!.citations as Array<Record<string, unknown>>;
    expect(citation).not.toHaveProperty("content");
    expect(citation).toMatchObject({
      chunkType: "text",
      score: 0.91,
      assetUrl: "https://assets.example/doc.pdf",
      description: "intro summary",
      source: {
        documentId: "doc_123",
        sourceFileName: "doc.pdf",
        sectionPath: "1. Introduction",
      },
    });
  });

  it("ensures one default thread per workspace and lists its messages", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");

    const first = await workspaceHelpers.ensureDefaultChatThread(ws.id);
    const second = await workspaceHelpers.ensureDefaultChatThread(ws.id);

    expect(second.id).toBe(first.id);
    expect(second.workspaceId).toBe(ws.id);

    await workspaceHelpers.appendMessageToThread(ws.id, {
      threadId: first.id,
      role: "user",
      content: "What changed?",
    });
    await workspaceHelpers.appendMessageToThread(ws.id, {
      threadId: first.id,
      role: "assistant",
      content: "The answer.",
    });

    const messages = await workspaceHelpers.listMessagesForThread(ws.id, first.id);
    expect(messages).not.toBeNull();
    expect(messages!.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages!.map((message) => message.content)).toEqual([
      "What changed?",
      "The answer.",
    ]);
  });

  it("listMessagesForThread rejects cross-workspace thread ids", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const otherWs = await workspaceHelpers.ensureWorkspace("user_2");
    const thread = await workspaceHelpers.ensureDefaultChatThread(ws.id);

    await workspaceHelpers.appendMessageToThread(ws.id, {
      threadId: thread.id,
      role: "user",
      content: "private",
    });

    await expect(
      workspaceHelpers.listMessagesForThread(otherWs.id, thread.id),
    ).resolves.toEqual(null);
  });

  it("soft-deleted threads don't cascade delete their messages", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const [thread] = await testDb
      .insert(chatThreads)
      .values({ workspaceId: ws.id })
      .returning();
    await testDb
      .insert(chatMessages)
      .values({ threadId: thread!.id, role: "user", content: "kept" });

    const ok = await workspaceHelpers.softDeleteChatThread(ws.id, thread!.id);
    expect(ok).toBe(true);

    const rows = await testDb
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, thread!.id));
    expect(rows.length).toBe(1);
    expect(rows[0]!.content).toBe("kept");
  });

  it("partial index: soft-deleted sources don't count against the sidebar list", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    await testDb.insert(sources).values([
      {
        workspaceId: ws.id,
        title: "live.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: "ready",
      },
      {
        workspaceId: ws.id,
        title: "deleted.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: "ready",
        deletedAt: new Date(),
      },
    ]);

    // Emulating the sidebar's hot read: workspace scoped, soft-delete
    // hidden. The partial index covers this exact predicate.
    const live = await testDb
      .select()
      .from(sources)
      .where(and(eq(sources.workspaceId, ws.id), isNull(sources.deletedAt)));
    expect(live.length).toBe(1);
    expect(live[0]!.title).toBe("live.pdf");
  });

  it("source repository creates and lists workspace-scoped source metadata", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const otherWs = await workspaceHelpers.ensureWorkspace("user_2");

    const source = await workspaceHelpers.createUploadingSource(ws.id, {
      title: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      stagedBlobPathname: "source-uploads/staged/lecture.pdf",
      stagedBlobUrl: "https://blob.example/staged/lecture.pdf",
      originalBlobPathname: "source-uploads/original/lecture.pdf",
      originalBlobUrl: "https://blob.example/original/lecture.pdf",
    });
    await workspaceHelpers.createUploadingSource(otherWs.id, {
      title: "private.pdf",
      mimeType: "application/pdf",
      sizeBytes: 512,
    });

    expect(source).toMatchObject({
      workspaceId: ws.id,
      title: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      status: "uploading",
      knowhereJobId: null,
      knowhereDocumentId: null,
      stagedBlobPathname: "source-uploads/staged/lecture.pdf",
      stagedBlobUrl: "https://blob.example/staged/lecture.pdf",
      originalBlobPathname: "source-uploads/original/lecture.pdf",
      originalBlobUrl: "https://blob.example/original/lecture.pdf",
    });

    const list = await workspaceHelpers.listSourcesForWorkspace(ws.id);
    expect(list.map((row) => row.title)).toEqual(["lecture.pdf"]);
  });

  it("source repository marks parsing, ready, and failed states in workspace scope", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const otherWs = await workspaceHelpers.ensureWorkspace("user_2");
    const source = await workspaceHelpers.createUploadingSource(ws.id, {
      title: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });

    const wrongParsing = await workspaceHelpers.markSourceParsing(
      otherWs.id,
      source.id,
      "job_wrong",
    );
    expect(wrongParsing).toBeNull();

    const parsing = await workspaceHelpers.markSourceParsing(
      ws.id,
      source.id,
      "job_123",
    );
    expect(parsing).toMatchObject({
      status: "parsing",
      knowhereJobId: "job_123",
      failureReason: null,
    });

    const ready = await workspaceHelpers.markSourceReady(
      ws.id,
      source.id,
      "doc_123",
    );
    expect(ready).toMatchObject({
      status: "ready",
      knowhereDocumentId: "doc_123",
      failureReason: null,
    });

    const failed = await workspaceHelpers.markSourceFailed(
      ws.id,
      source.id,
      "Parsing failed.",
    );
    expect(failed).toMatchObject({
      status: "failed",
      failureReason: "Parsing failed.",
    });
  });

  it("source parse results upsert asset urls inside the source workspace", async () => {
    const ws = await workspaceHelpers.ensureWorkspace("user_1");
    const otherWs = await workspaceHelpers.ensureWorkspace("user_2");
    const source = await workspaceHelpers.createUploadingSource(ws.id, {
      title: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });

    const first = await workspaceHelpers.saveSourceParseResult(ws.id, source.id, {
      resultBlobUrl: "https://blob.example/result-v1.zip",
      assetUrlsByFilePath: {
        "images/image-1.png": "https://blob.example/image-1.png",
      },
    });
    const second = await workspaceHelpers.saveSourceParseResult(
      ws.id,
      source.id,
      {
        resultBlobUrl: "https://blob.example/result-v2.zip",
        assetUrlsByFilePath: {
          "images/image-2.png": "https://blob.example/image-2.png",
        },
      },
    );
    const crossWorkspace = await workspaceHelpers.saveSourceParseResult(
      otherWs.id,
      source.id,
      {
        resultBlobUrl: "https://blob.example/private.zip",
        assetUrlsByFilePath: {},
      },
    );

    expect(first?.id).toBe(second?.id);
    expect(crossWorkspace).toBeNull();
    await expect(
      workspaceHelpers.getParseAssetUrls(ws.id, source.id),
    ).resolves.toEqual({
      "images/image-2.png": "https://blob.example/image-2.png",
    });
    await expect(
      workspaceHelpers.getParseAssetUrls(otherWs.id, source.id),
    ).resolves.toEqual({});
  });
});
