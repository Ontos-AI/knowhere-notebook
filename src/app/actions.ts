"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { getKnowhereClient } from "@/lib/knowhere";
import { toSourceView } from "@/lib/source-view";
import { localTempFiles } from "@/lib/temp-files";
import { uploadSourceToKnowhere } from "@/lib/source-upload";
import {
  createUploadingSource,
  ensureWorkspace,
  markSourceFailed,
  markSourceParsing,
} from "@/lib/workspace";

export type UploadSourceActionState = {
  ok: boolean;
  message: string | null;
  source?: ReturnType<typeof toSourceView>;
};

export async function uploadSourceAction(
  _state: UploadSourceActionState,
  formData: FormData,
): Promise<UploadSourceActionState> {
  const user = await requireUser();
  const workspace = await ensureWorkspace(user.id);
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a document to upload." };
  }

  try {
    const source = await uploadSourceToKnowhere(workspace, file, {
      repository: {
        createUploadingSource,
        markSourceParsing: async (...args) => {
          const source = await markSourceParsing(...args);
          if (!source) throw new Error("Source disappeared before parsing.");
          return source;
        },
        markSourceFailed: async (...args) => {
          const source = await markSourceFailed(...args);
          if (!source) throw new Error("Source disappeared before failure.");
          return source;
        },
      },
      knowhere: getKnowhereClient(),
      tempFiles: localTempFiles,
    });
    revalidatePath("/");
    return { ok: true, message: null, source: toSourceView(source) };
  } catch (err) {
    revalidatePath("/");
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Upload failed. Try again or choose another file.",
    };
  }
}
