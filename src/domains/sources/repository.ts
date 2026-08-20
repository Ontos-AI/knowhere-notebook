import "server-only"

import { demoSourceRepository } from "./demo-source-repository"
import { sourceParseResultRepository } from "./source-parse-result-repository"
import { sourceRowRepository } from "./source-row-repository"

type SourceRepository = {
  readonly findInWorkspaceEffect: typeof sourceRowRepository.findInWorkspaceEffect
  readonly findByKnowhereDocumentIdEffect: typeof sourceRowRepository.findByKnowhereDocumentIdEffect
  readonly listForWorkspaceEffect: typeof sourceRowRepository.listForWorkspaceEffect
  readonly createUploadingEffect: typeof sourceRowRepository.createUploadingEffect
  readonly localizeRemoteDocumentEffect: typeof sourceRowRepository.localizeRemoteDocumentEffect
  readonly listHiddenDemoSourceIdsEffect: typeof demoSourceRepository.listHiddenDemoSourceIdsEffect
  readonly hideDemoSourceEffect: typeof demoSourceRepository.hideDemoSourceEffect
  readonly upsertMaterializedDemoSourceEffect: typeof demoSourceRepository.upsertMaterializedDemoSourceEffect
  readonly markParsingEffect: typeof sourceRowRepository.markParsingEffect
  readonly markReadyEffect: typeof sourceRowRepository.markReadyEffect
  readonly updateRevisionKeyEffect: typeof sourceRowRepository.updateRevisionKeyEffect
  readonly markFailedEffect: typeof sourceRowRepository.markFailedEffect
  readonly clearStagedBlobEffect: typeof sourceRowRepository.clearStagedBlobEffect
  readonly softDeleteEffect: typeof sourceRowRepository.softDeleteEffect
  readonly saveParseResultEffect: typeof sourceParseResultRepository.saveParseResultEffect
  readonly mergeParseAssetUrlsEffect: typeof sourceParseResultRepository.mergeParseAssetUrlsEffect
  readonly getParseResultProgressEffect: typeof sourceParseResultRepository.getParseResultProgressEffect
  readonly getParseSnapshotMetadataEffect: typeof sourceParseResultRepository.getParseSnapshotMetadataEffect
  readonly getParseAssetUrlsEffect: typeof sourceParseResultRepository.getParseAssetUrlsEffect
  readonly updateSyncStatusEffect: typeof sourceParseResultRepository.updateSyncStatusEffect
}

export const sourceRepository: SourceRepository = {
  findInWorkspaceEffect: sourceRowRepository.findInWorkspaceEffect,
  findByKnowhereDocumentIdEffect:
    sourceRowRepository.findByKnowhereDocumentIdEffect,
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
  updateRevisionKeyEffect: sourceRowRepository.updateRevisionKeyEffect,
  markFailedEffect: sourceRowRepository.markFailedEffect,
  clearStagedBlobEffect: sourceRowRepository.clearStagedBlobEffect,
  softDeleteEffect: sourceRowRepository.softDeleteEffect,
  saveParseResultEffect: sourceParseResultRepository.saveParseResultEffect,
  mergeParseAssetUrlsEffect:
    sourceParseResultRepository.mergeParseAssetUrlsEffect,
  getParseResultProgressEffect:
    sourceParseResultRepository.getParseResultProgressEffect,
  getParseSnapshotMetadataEffect:
    sourceParseResultRepository.getParseSnapshotMetadataEffect,
  getParseAssetUrlsEffect: sourceParseResultRepository.getParseAssetUrlsEffect,
  updateSyncStatusEffect: sourceParseResultRepository.updateSyncStatusEffect,
}
