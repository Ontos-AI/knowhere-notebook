import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { TempFileStore } from "./source-upload";

export const localTempFiles: TempFileStore = {
  async write(file) {
    const directory = await mkdtemp(join(tmpdir(), "knowhere-notebook-"));
    const path = join(directory, basename(file.name));
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(path, bytes);
    return {
      path,
      async cleanup() {
        await rm(directory, { recursive: true, force: true });
      },
    };
  },
};
