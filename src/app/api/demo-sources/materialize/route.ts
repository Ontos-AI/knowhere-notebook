import { Effect } from "effect"
import type { NextResponse } from "next/server"

import { chatCitationPersistence } from "@/domains/chat/chat-citation-persistence"
import { chatMessageRepository } from "@/domains/chat/chat-message-repository"
import { chatThreadRepository } from "@/domains/chat/chat-thread-repository"
import type { ChatCitationView } from "@/domains/chat/types"
import { demoOriginalFile } from "@/domains/demo/original-file"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { sourceService } from "@/domains/sources/service"
import { toSourceView } from "@/domains/sources/view"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import { knowhereDemoApi } from "@/integrations/knowhere-demo"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: Request): Promise<NextResponse> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const body = yield* Effect.tryPromise(() =>
        routeResult.readJson(request),
      )
      if (!body.ok) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Invalid request body."),
        )
      }

      const demoSourceIds = getDemoSourceIds(body.value)
      if (demoSourceIds.length === 0) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Select at least one demo source."),
        )
      }

      const { apiKey, workspace } = yield* Effect.tryPromise(() =>
        notebookRequestContext.getAuthenticatedWithClient(),
      )
      const hiddenDemoSourceIds = new Set(
        yield* Effect.tryPromise(() =>
          sourceService.listHiddenDemoSourceIds(workspace.id),
        ),
      )
      const visibleDemoSourceIds = demoSourceIds.filter(
        (demoSourceId) => !hiddenDemoSourceIds.has(demoSourceId),
      )
      if (visibleDemoSourceIds.length === 0) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest(
            "Selected demo sources are no longer available.",
          ),
        )
      }

      const materializedSources = yield* Effect.tryPromise(() =>
        knowhereDemoApi.materializeSources({
          apiKey,
          namespace: workspace.namespace,
          demoSourceIds: visibleDemoSourceIds,
        }),
      )

      const sources = yield* Effect.all(
        materializedSources.map((source) =>
          Effect.gen(function* () {
            const row = yield* Effect.tryPromise(() =>
              sourceService.upsertMaterializedDemoSource(workspace.id, {
                demoSourceId: source.demoSourceId,
                title: source.title,
                mimeType: source.mimeType,
                sizeBytes: source.sizeBytes,
                knowhereDocumentId: source.documentId,
                originalBlobUrl: demoOriginalFile.getPublicUrl(source),
              }),
            )
            return toSourceView(row, { chunkCount: source.chunkCount })
          }),
        ),
        { concurrency: "unbounded" },
      )

      // After materialization, remap seeded demo-thread citations from their
      // canonical document IDs to the new materialized document IDs so source
      // citation resolution continues to work.
      yield* Effect.tryPromise(() =>
        fixDemoThreadCitations(workspace.id, materializedSources),
      ).pipe(Effect.catchAllCause(() => Effect.void))

      return nextRouteResponse.toNextResponse(routeResult.ok({ sources }))
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed(
          nextRouteResponse.toNextResponse(
            routeResult.error(
              502,
              "Demo sources could not be prepared right now.",
            ),
          ),
        ),
      ),
    ),
  )
}

function getDemoSourceIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.demoSourceIds)) return []

  const selectedIds = value.demoSourceIds.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  )
  return Array.from(new Set(selectedIds.map((item) => item.trim())))
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

const seededDemoChatKey = "knowhere-demo-chat"

async function fixDemoThreadCitations(
  workspaceId: string,
  materializedSources: ReadonlyArray<{
    readonly demoSourceId: string
    readonly documentId: string
  }>,
): Promise<void> {
  const catalog = await knowhereDemoApi.fetchCatalog()
  const canonicalIdByDemoSourceId = new Map(
    catalog.sources.map((s) => [s.demoSourceId, s.canonicalDocumentId]),
  )
  const documentIdMap = new Map<string, string>()
  for (const source of materializedSources) {
    const canonical = canonicalIdByDemoSourceId.get(source.demoSourceId)
    if (canonical) {
      documentIdMap.set(canonical, source.documentId)
    }
  }
  if (documentIdMap.size === 0) return

  const thread = await databaseRuntime.runPromise(
    chatThreadRepository.findThreadByDemoKeyEffect(
      workspaceId,
      seededDemoChatKey,
    ),
  )
  if (!thread) return

  const messages = await databaseRuntime.runPromise(
    chatMessageRepository.listMessagesForThreadEffect(workspaceId, thread.id),
  )
  if (!messages || messages.length === 0) return

  await Promise.all(
    messages.map(async (message) => {
      const currentCitations = message.citations as
        | ChatCitationView[]
        | null
        | undefined
      const updated = chatCitationPersistence.replaceDemoCitationDocumentId(
        currentCitations ?? undefined,
        documentIdMap,
      )
      if (!updated) return

      await databaseRuntime.runPromise(
        chatMessageRepository.updateMessageCitationsEffect(
          message.id,
          chatCitationPersistence.normalizeCitations(updated),
        ),
      )
    }),
  )
}
