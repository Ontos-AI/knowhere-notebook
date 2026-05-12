import { access } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { appMetadata } from "./app-metadata";

const notebookIconPath = "/images/knowhere/logo-icon.png" as const;
const rootDirectory: string = process.cwd();

async function hasFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("notebook page icon", () => {
  it("configures the Knowhere mark as an HTML icon", () => {
    const serializedIcons: string = JSON.stringify(appMetadata.icons);

    expect(serializedIcons).toContain(notebookIconPath);
    expect(serializedIcons).toContain("image/png");
  });

  it("keeps the configured icon asset available from public", async () => {
    const iconFilePath: string = path.join(
      rootDirectory,
      "public",
      "images",
      "knowhere",
      "logo-icon.png",
    );

    await expect(hasFile(iconFilePath)).resolves.toBe(true);
  });
});
