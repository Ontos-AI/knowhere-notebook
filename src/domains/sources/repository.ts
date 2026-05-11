import "server-only"

import { demoSourceRepository } from "./demo-source-repository"
import { sourceParseResultRepository } from "./source-parse-result-repository"
import { sourceRowRepository } from "./source-row-repository"

type SourceRepository = {
  readonly findInWorkspaceEffect: typeof sourceRowRepository.findInWorkspaceEffect
  readonly findByDemoKeyEffect: typeof demoSourceRepository.findByDemoKeyEffect
  readonly listForWorkspaceEffect: typeof sourceRowRepository.listForWorkspaceEffect
  readonly createUploadingEffect: typeof sourceRowRepository.createUploadingEffect
  readonly createDemoUploadingEffect: typeof demoSourceRepository.createDemoUploadingEffect
  readonly markDemoUploadingEffect: typeof demoSourceRepository.markDemoUploadingEffect
  readonly markParsingEffect: typeof sourceRowRepository.markParsingEffect
  readonly markReadyEffect: typeof sourceRowRepository.markReadyEffect
  readonly markFailedEffect: typeof sourceRowRepository.markFailedEffect
  readonly clearStagedBlobEffect: typeof sourceRowRepository.clearStagedBlobEffect
  readonly softDeleteEffect: typeof sourceRowRepository.softDeleteEffect
  readonly saveParseResultEffect: typeof sourceParseResultRepository.saveParseResultEffect
  readonly getParseAssetUrlsEffect: typeof sourceParseResultRepository.getParseAssetUrlsEffect
  readonly createDemoUploadRepository: typeof demoSourceRepository.createDemoUploadRepository
}

export const sourceRepository: SourceRepository = {
  findInWorkspaceEffect: sourceRowRepository.findInWorkspaceEffect,
  findByDemoKeyEffect: demoSourceRepository.findByDemoKeyEffect,
  listForWorkspaceEffect: sourceRowRepository.listForWorkspaceEffect,
  createUploadingEffect: sourceRowRepository.createUploadingEffect,
  createDemoUploadingEffect: demoSourceRepository.createDemoUploadingEffect,
  markDemoUploadingEffect: demoSourceRepository.markDemoUploadingEffect,
  markParsingEffect: sourceRowRepository.markParsingEffect,
  markReadyEffect: sourceRowRepository.markReadyEffect,
  markFailedEffect: sourceRowRepository.markFailedEffect,
  clearStagedBlobEffect: sourceRowRepository.clearStagedBlobEffect,
  softDeleteEffect: sourceRowRepository.softDeleteEffect,
  saveParseResultEffect: sourceParseResultRepository.saveParseResultEffect,
  getParseAssetUrlsEffect: sourceParseResultRepository.getParseAssetUrlsEffect,
  createDemoUploadRepository: demoSourceRepository.createDemoUploadRepository,
}
