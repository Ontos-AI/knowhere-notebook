import "server-only"

import { databaseRuntime } from "./database-runtime"
import { chatRepository } from "../chat/repository"
import { sourceService } from "../sources/service"
import { workspaceService } from "./service"
import type { Workspace } from "@/infrastructure/db/schema"
import type { UploadKnowhereClient } from "../sources/upload"
import type { CitationView, RetrievalResultView } from "@/lib/types"

// Compatibility facade. New code should prefer the service/repository modules.

export const ensureWorkspaceEffect = workspaceService.ensureWorkspaceEffect

export const ensureDemoWorkspaceContentEffect =
  workspaceService.ensureDemoWorkspaceContentEffect

export const findSourceInWorkspaceEffect = sourceService.findInWorkspaceEffect

export const listSourcesForWorkspaceEffect = sourceService.listForWorkspaceEffect

export const createUploadingSourceEffect = sourceService.createUploadingEffect

export const markSourceParsingEffect = sourceService.markParsingEffect

export const markSourceReadyEffect = sourceService.markReadyEffect

export const markSourceFailedEffect = sourceService.markFailedEffect

export const clearSourceStagedBlobEffect = sourceService.clearStagedBlobEffect

export const saveSourceParseResultEffect = sourceService.saveParseResultEffect

export const getSourceParseAssetUrlsEffect = sourceService.getParseAssetUrlsEffect

export const findChatThreadInWorkspaceEffect =
  chatRepository.findThreadInWorkspaceEffect

export const listChatThreadsForWorkspaceEffect =
  chatRepository.listThreadsForWorkspaceEffect

export const createChatThreadEffect = chatRepository.createThreadEffect

export const ensureDefaultChatThreadEffect =
  chatRepository.ensureDefaultThreadEffect

export const listMessagesForThreadEffect =
  chatRepository.listMessagesForThreadEffect

export const softDeleteSourceEffect = sourceService.softDeleteEffect

export const softDeleteChatThreadEffect = chatRepository.softDeleteThreadEffect

export const appendMessageToThreadEffect =
  chatRepository.appendMessageToThreadEffect

export const pingDatabaseEffect = workspaceService.pingDatabaseEffect()

export const ensureWorkspace = workspaceService.ensureWorkspace

export const ensureDemoWorkspaceContent = (
  workspace: Workspace,
  knowhere: UploadKnowhereClient,
) => workspaceService.ensureDemoWorkspaceContent(workspace, knowhere)

export const findSourceInWorkspace = sourceService.findInWorkspace

export const listSourcesForWorkspace = sourceService.listForWorkspace

export const createUploadingSource = sourceService.createUploading

export const markSourceParsing = sourceService.markParsing

export const markSourceReady = sourceService.markReady

export const markSourceFailed = sourceService.markFailed

export const clearSourceStagedBlob = sourceService.clearStagedBlob

export const saveSourceParseResult = sourceService.saveParseResult

export const getSourceParseAssetUrls = sourceService.getParseAssetUrls

export const findChatThreadInWorkspace = (
  workspaceId: string,
  threadId: string,
) =>
  databaseRuntime.runPromise(
    findChatThreadInWorkspaceEffect(workspaceId, threadId),
  )

export const listChatThreadsForWorkspace = (workspaceId: string) =>
  databaseRuntime.runPromise(listChatThreadsForWorkspaceEffect(workspaceId))

export const createChatThread = (workspaceId: string) =>
  databaseRuntime.runPromise(createChatThreadEffect(workspaceId))

export const ensureDefaultChatThread = (workspaceId: string) =>
  databaseRuntime.runPromise(ensureDefaultChatThreadEffect(workspaceId))

export const listMessagesForThread = (
  workspaceId: string,
  threadId: string,
) =>
  databaseRuntime.runPromise(listMessagesForThreadEffect(workspaceId, threadId))

export const softDeleteSource = sourceService.softDelete

export const softDeleteChatThread = (workspaceId: string, threadId: string) =>
  databaseRuntime.runPromise(softDeleteChatThreadEffect(workspaceId, threadId))

export const appendMessageToThread = (
  workspaceId: string,
  input: {
    threadId: string
    role: "user" | "assistant"
    content: string
    citations?: readonly (CitationView | RetrievalResultView)[] | null
  },
) => databaseRuntime.runPromise(appendMessageToThreadEffect(workspaceId, input))

export const pingDatabase = workspaceService.pingDatabase
