import "server-only"

import { demoSourceRepository } from "./demo-source-repository"
import { sourceParseResultRepository } from "./source-parse-result-repository"
import { sourceRowRepository } from "./source-row-repository"

type SourceRepository = {
  readonly findInWorkspaceEffect: typeof sourceRowRepository.findInWorkspaceEffect
  readonly listForWorkspaceEffect: typeof sourceRowRepository.listForWorkspaceEffect
  readonly createUploadingEffect: typeof sourceRowRepository.createUploadingEffect
  readonly localizeRemoteDocumentEffect: typeof sourceRowRepository.localizeRemoteDocumentEffect
  readonly listHiddenDemoSourceIdsEffect: typeof demoSourceRepository.listHiddenDemoSourceIdsEffect
  readonly hideDemoSourceEffect: typeof demoSourceRepository.hideDemoSourceEffect
  readonly upsertMaterializedDemoSourceEffect: typeof demoSourceRepository.upsertMaterializedDemoSourceEffect
  readonly markParsingEffect: typeof sourceRowRepository.markParsingEffect
  readonly markReadyEffect: typeof sourceRowRepository.markReadyEffect
  readonly markFailedEffect: typeof sourceRowRepository.markFailedEffect
  readonly clearStagedBlobEffect: typeof sourceRowRepository.clearStagedBlobEffect
  readonly softDeleteEffect: typeof sourceRowRepository.softDeleteEffect
  readonly saveParseResultEffect: typeof sourceParseResultRepository.saveParseResultEffect
  readonly getParseAssetUrlsEffect: typeof sourceParseResultRepository.getParseAssetUrlsEffect
}

export const sourceRepository: SourceRepository = {
  findInWorkspaceEffect: sourceRowRepository.findInWorkspaceEffect,
  listForWorkspaceEffect: sourceRowRepository.listForWorkspaceEffect,
  createUploadingEffect: sourceRowRepository.createUploadingEffect,
  localizeRemoteDocumentEffect:
    sourceRowRepository.localizeRemoteDocumentEffect,
  listHiddenDemoSourceIdsEffect: demoSourceRepository.listHiddenDemoSourceIdsEffect,
  hideDemoSourceEffect: demoSourceRepository.hideDemoSourceEffect,
  upsertMaterializedDemoSourceEffect:
    demoSourceRepository.upsertMaterializedDemoSourceEffect,
  markParsingEffect: sourceRowRepository.markParsingEffect,
  markReadyEffect: sourceRowRepository.markReadyEffect,
  markFailedEffect: sourceRowRepository.markFailedEffect,
  clearStagedBlobEffect: sourceRowRepository.clearStagedBlobEffect,
  softDeleteEffect: sourceRowRepository.softDeleteEffect,
  saveParseResultEffect: sourceParseResultRepository.saveParseResultEffect,
  getParseAssetUrlsEffect: sourceParseResultRepository.getParseAssetUrlsEffect,
}
