import { describe, expect, it } from "vitest"

import type { SourceView } from "@/domains/sources/types"
import {
  canAssignSourceToFolder,
  getDescendantFolderIds,
  getFolderPath,
  listChildFolders,
  listSourcesInFolder,
} from "./tree"
import type { FolderView } from "./types"

describe("folder tree", () => {
  const folders: FolderView[] = [
    { id: "folder_cardio", parentId: null, name: "Cardio" },
    { id: "folder_2024", parentId: "folder_cardio", name: "2024" },
    { id: "folder_other", parentId: null, name: "Other" },
  ]

  it("lists child folders in name order", () => {
    expect(listChildFolders(folders, null).map((folder) => folder.id)).toEqual([
      "folder_cardio",
      "folder_other",
    ])
    expect(
      listChildFolders(folders, "folder_cardio").map((folder) => folder.id),
    ).toEqual(["folder_2024"])
  })

  it("builds the breadcrumb path from root to the current folder", () => {
    expect(getFolderPath(folders, "folder_2024").map((folder) => folder.name)).toEqual(
      ["Cardio", "2024"],
    )
    expect(getFolderPath(folders, null)).toEqual([])
  })

  it("includes a folder and its descendants", () => {
    expect(new Set(getDescendantFolderIds(folders, "folder_cardio"))).toEqual(
      new Set(["folder_cardio", "folder_2024"]),
    )
  })

  it("lists sources sitting in one folder", () => {
    const sources: SourceView[] = [
      makeSource({ id: "source_root" }),
      makeSource({ id: "source_cardio", folderId: "folder_cardio" }),
      makeSource({ id: "source_2024", folderId: "folder_2024" }),
    ]

    expect(listSourcesInFolder(sources, null).map((source) => source.id)).toEqual([
      "source_root",
    ])
    expect(
      listSourcesInFolder(sources, "folder_cardio").map((source) => source.id),
    ).toEqual(["source_cardio"])
  })

  it("keeps demo and remote sources out of folder assignment", () => {
    expect(canAssignSourceToFolder(makeSource({ id: "source_workspace" }))).toBe(
      true,
    )
    expect(
      canAssignSourceToFolder(
        makeSource({ id: "source_demo", demoSourceId: "demo-1" }),
      ),
    ).toBe(false)
    expect(
      canAssignSourceToFolder(makeSource({ id: "source_remote", kind: "remote" })),
    ).toBe(false)
  })
})

function makeSource(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: "source_1",
    title: "notes.pdf",
    mimeType: "application/pdf",
    status: "ready",
    ...overrides,
  }
}
