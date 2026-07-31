import "server-only"

import { sourceParseResultRepository } from "./source-parse-result-repository"
import { sourceRowRepository } from "./source-row-repository"

type SourceRepository = {
  readonly findInWorkspaceEffect: typeof sourceRowRepository.findInWorkspaceEffect
  readonly listForWorkspaceEffect: typeof sourceRowRepository.listForWorkspaceEffect
  readonly createUploadingEffect: typeof sourceRowRepository.createUploadingEffect
  readonly localizeRemoteDocumentEffect: typeof sourceRowRepository.localizeRemoteDocumentEffect
  readonly markParsingEffect: typeof sourceRowRepository.markParsingEffect
  readonly markReadyEffect: typeof sourceRowRepository.markReadyEffect
  readonly updateRevisionKeyEffect: typeof sourceRowRepository.updateRevisionKeyEffect
  readonly markFailedEffect: typeof sourceRowRepository.markFailedEffect
  readonly clearStagedBlobEffect: typeof sourceRowRepository.clearStagedBlobEffect
  readonly softDeleteEffect: typeof sourceRowRepository.softDeleteEffect
  readonly saveParseResultEffect: typeof sourceParseResultRepository.saveParseResultEffect
  readonly mergeParseAssetUrlsEffect: typeof sourceParseResultRepository.mergeParseAssetUrlsEffect
  readonly getParseResultProgressEffect: typeof sourceParseResultRepository.getParseResultProgressEffect
  readonly getParseAssetUrlsEffect: typeof sourceParseResultRepository.getParseAssetUrlsEffect
}

export const sourceRepository: SourceRepository = {
  findInWorkspaceEffect: sourceRowRepository.findInWorkspaceEffect,
  listForWorkspaceEffect: sourceRowRepository.listForWorkspaceEffect,
  createUploadingEffect: sourceRowRepository.createUploadingEffect,
  localizeRemoteDocumentEffect:
    sourceRowRepository.localizeRemoteDocumentEffect,
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
  getParseAssetUrlsEffect: sourceParseResultRepository.getParseAssetUrlsEffect,
}
