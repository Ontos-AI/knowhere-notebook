import "server-only";

import type { Job } from "@ontos-ai/knowhere-sdk";

import type { Source, Workspace } from "./schema";
import { validateUploadFile } from "./source-validation";

export type UploadSourceRepository = {
  createUploadingSource(
    workspaceId: string,
    input: {
      title: string;
      mimeType: string;
      sizeBytes: number;
    },
  ): Promise<Source>;
  markSourceParsing(
    workspaceId: string,
    sourceId: string,
    jobId: string,
  ): Promise<Source>;
  markSourceFailed(
    workspaceId: string,
    sourceId: string,
    reason: string,
  ): Promise<Source>;
};

export type UploadKnowhereClient = {
  jobs: {
    create(input: {
      sourceType: "file";
      fileName: string;
      namespace: string;
    }): Promise<Job>;
    upload(job: string | Job, input: { file: string }): Promise<void>;
  };
};

export type TempFileStore = {
  write(file: File): Promise<{
    path: string;
    cleanup(): Promise<void>;
  }>;
};

export type UploadSourceDependencies = {
  repository: UploadSourceRepository;
  knowhere: UploadKnowhereClient;
  tempFiles: TempFileStore;
};

export async function uploadSourceToKnowhere(
  workspace: Workspace,
  file: File,
  deps: UploadSourceDependencies,
): Promise<Source> {
  const validation = validateUploadFile(file);
  if (!validation.ok) throw new Error(validation.message);

  const source = await deps.repository.createUploadingSource(workspace.id, {
    title: validation.title,
    mimeType: validation.mimeType,
    sizeBytes: file.size,
  });

  let tempFile: Awaited<ReturnType<TempFileStore["write"]>> | null = null;
  try {
    tempFile = await deps.tempFiles.write(file);
    const job = await deps.knowhere.jobs.create({
      sourceType: "file",
      fileName: validation.title,
      namespace: workspace.namespace,
    });
    await deps.knowhere.jobs.upload(job, { file: tempFile.path });
    return await deps.repository.markSourceParsing(
      workspace.id,
      source.id,
      job.jobId,
    );
  } catch (err) {
    const message = "Knowhere upload failed.";
    await deps.repository.markSourceFailed(workspace.id, source.id, message);
    throw new Error(message, { cause: err });
  } finally {
    await tempFile?.cleanup();
  }
}
