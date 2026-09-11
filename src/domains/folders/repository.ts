import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient, type Db } from "@/infrastructure/db"
import { folders, sources, type Folder } from "@/infrastructure/db/schema"
import type { FolderMutationError, FolderWriteResult } from "./types"

const FOLDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const FOLDER_NAME_MAX_LENGTH = 80

type FolderRepository = {
  readonly listForWorkspaceEffect: (
    workspaceId: string,
  ) => Effect.Effect<Folder[], never, DbClient>
  readonly findInWorkspaceEffect: (
    workspaceId: string,
    folderId: string,
  ) => Effect.Effect<Folder | null, never, DbClient>
  readonly createFolderEffect: (
    workspaceId: string,
    parentId: string | null,
    name: string,
  ) => Effect.Effect<FolderWriteResult<Folder>, never, DbClient>
  readonly renameFolderEffect: (
    workspaceId: string,
    folderId: string,
    name: string,
  ) => Effect.Effect<FolderWriteResult<Folder>, never, DbClient>
  readonly moveFolderEffect: (
    workspaceId: string,
    folderId: string,
    parentId: string | null,
  ) => Effect.Effect<FolderWriteResult<Folder>, never, DbClient>
  readonly softDeleteFolderEffect: (
    workspaceId: string,
    folderId: string,
  ) => Effect.Effect<FolderWriteResult<true>, never, DbClient>
  readonly resolveDescendantSourceIdsEffect: (
    workspaceId: string,
    folderId: string,
  ) => Effect.Effect<readonly string[], never, DbClient>
}

const listForWorkspaceEffect: FolderRepository["listForWorkspaceEffect"] = (
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      db
        .select()
        .from(folders)
        .where(
          and(eq(folders.workspaceId, workspaceId), isNull(folders.deletedAt)),
        ),
    )
  })

const findInWorkspaceEffect: FolderRepository["findInWorkspaceEffect"] = (
  workspaceId: string,
  folderId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      findFolderInWorkspace(db, workspaceId, folderId),
    )
  })

const createFolderEffect: FolderRepository["createFolderEffect"] = (
  workspaceId: string,
  parentId: string | null,
  name: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const normalizedName = normalizeFolderName(name)
    if (!normalizedName) return fail("folder-name-invalid")

    const parentCheck = yield* Effect.promise(() =>
      assertParentFolder(db, workspaceId, parentId),
    )
    if (!parentCheck.ok) return parentCheck

    const conflict = yield* Effect.promise(() =>
      findSiblingNameConflict(db, workspaceId, parentId, normalizedName),
    )
    if (conflict) return fail("folder-name-conflict")

    const [folder] = yield* Effect.promise(() =>
      db
        .insert(folders)
        .values({
          workspaceId,
          parentId,
          name: normalizedName,
        })
        .returning(),
    )
    if (!folder) {
      return yield* Effect.die(new Error("createFolder: insert did not return a row."))
    }

    return succeed(folder)
  })

const renameFolderEffect: FolderRepository["renameFolderEffect"] = (
  workspaceId: string,
  folderId: string,
  name: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const normalizedName = normalizeFolderName(name)
    if (!normalizedName) return fail("folder-name-invalid")

    const folder = yield* Effect.promise(() =>
      findFolderInWorkspace(db, workspaceId, folderId),
    )
    if (!folder) return fail("folder-not-found")

    const conflict = yield* Effect.promise(() =>
      findSiblingNameConflict(
        db,
        workspaceId,
        folder.parentId,
        normalizedName,
        folderId,
      ),
    )
    if (conflict) return fail("folder-name-conflict")

    const [updated] = yield* Effect.promise(() =>
      db
        .update(folders)
        .set({ name: normalizedName, updatedAt: sql`now()` })
        .where(
          and(
            eq(folders.id, folderId),
            eq(folders.workspaceId, workspaceId),
            isNull(folders.deletedAt),
          ),
        )
        .returning(),
    )
    if (!updated) return fail("folder-not-found")
    return succeed(updated)
  })

const moveFolderEffect: FolderRepository["moveFolderEffect"] = (
  workspaceId: string,
  folderId: string,
  parentId: string | null,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const folder = yield* Effect.promise(() =>
      findFolderInWorkspace(db, workspaceId, folderId),
    )
    if (!folder) return fail("folder-not-found")
    if (parentId === folderId) return fail("folder-cycle")

    const parentCheck = yield* Effect.promise(() =>
      assertParentFolder(db, workspaceId, parentId),
    )
    if (!parentCheck.ok) return parentCheck

    if (parentId) {
      const isCycle = yield* Effect.promise(() =>
        isFolderInSubtree(db, workspaceId, folderId, parentId),
      )
      if (isCycle) return fail("folder-cycle")
    }

    const conflict = yield* Effect.promise(() =>
      findSiblingNameConflict(
        db,
        workspaceId,
        parentId,
        folder.name,
        folderId,
      ),
    )
    if (conflict) return fail("folder-name-conflict")

    const [updated] = yield* Effect.promise(() =>
      db
        .update(folders)
        .set({ parentId, updatedAt: sql`now()` })
        .where(
          and(
            eq(folders.id, folderId),
            eq(folders.workspaceId, workspaceId),
            isNull(folders.deletedAt),
          ),
        )
        .returning(),
    )
    if (!updated) return fail("folder-not-found")
    return succeed(updated)
  })

const softDeleteFolderEffect: FolderRepository["softDeleteFolderEffect"] = (
  workspaceId: string,
  folderId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const folder = yield* Effect.promise(() =>
      findFolderInWorkspace(db, workspaceId, folderId),
    )
    if (!folder) return fail("folder-not-found")

    const [childFolder] = yield* Effect.promise(() =>
      db
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.workspaceId, workspaceId),
            eq(folders.parentId, folderId),
            isNull(folders.deletedAt),
          ),
        )
        .limit(1),
    )
    if (childFolder) return fail("folder-not-empty")

    const [childSource] = yield* Effect.promise(() =>
      db
        .select({ id: sources.id })
        .from(sources)
        .where(
          and(
            eq(sources.workspaceId, workspaceId),
            eq(sources.folderId, folderId),
            isNull(sources.deletedAt),
          ),
        )
        .limit(1),
    )
    if (childSource) return fail("folder-not-empty")

    const [deleted] = yield* Effect.promise(() =>
      db
        .update(folders)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(folders.id, folderId),
            eq(folders.workspaceId, workspaceId),
            isNull(folders.deletedAt),
          ),
        )
        .returning({ id: folders.id }),
    )
    if (!deleted) return fail("folder-not-found")
    return succeed(true as const)
  })

const resolveDescendantSourceIdsEffect: FolderRepository["resolveDescendantSourceIdsEffect"] =
  (workspaceId: string, folderId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      if (!isFolderId(folderId)) return []

      const rows = yield* Effect.promise(() =>
        db.execute<{ id: string }>(sql`
          WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = ${folderId}::uuid
              AND workspace_id = ${workspaceId}::uuid
              AND deleted_at IS NULL
            UNION ALL
            SELECT folders.id
            FROM folders
            INNER JOIN folder_tree ON folders.parent_id = folder_tree.id
            WHERE folders.workspace_id = ${workspaceId}::uuid
              AND folders.deleted_at IS NULL
          )
          SELECT sources.id
          FROM sources
          INNER JOIN folder_tree ON sources.folder_id = folder_tree.id
          WHERE sources.workspace_id = ${workspaceId}::uuid
            AND sources.deleted_at IS NULL
        `),
      )

      return readExecuteIds(rows)
    })

function isFolderId(folderId: string): boolean {
  return FOLDER_ID_PATTERN.test(folderId)
}

function normalizeFolderName(value: string): string | null {
  const name = value.replace(/\s+/g, " ").trim()
  if (name.length === 0 || name.length > FOLDER_NAME_MAX_LENGTH) return null
  return name
}

async function findFolderInWorkspace(
  db: Db,
  workspaceId: string,
  folderId: string,
): Promise<Folder | null> {
  if (!isFolderId(folderId)) return null

  const [folder] = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.workspaceId, workspaceId),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1)

  return folder ?? null
}

async function assertParentFolder(
  db: Db,
  workspaceId: string,
  parentId: string | null,
): Promise<FolderWriteResult<true>> {
  if (parentId === null) return succeed(true)
  const parent = await findFolderInWorkspace(db, workspaceId, parentId)
  if (!parent) return fail("invalid-parent-folder")
  return succeed(true)
}

async function findSiblingNameConflict(
  db: Db,
  workspaceId: string,
  parentId: string | null,
  name: string,
  excludeFolderId?: string,
): Promise<Folder | null> {
  const parentCondition =
    parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId)
  const conditions = [
    eq(folders.workspaceId, workspaceId),
    parentCondition,
    eq(folders.name, name),
    isNull(folders.deletedAt),
  ]
  if (excludeFolderId) {
    conditions.push(sql`${folders.id} <> ${excludeFolderId}::uuid`)
  }
  const [conflict] = await db
    .select()
    .from(folders)
    .where(and(...conditions))
    .limit(1)

  return conflict ?? null
}

async function isFolderInSubtree(
  db: Db,
  workspaceId: string,
  folderId: string,
  candidateId: string,
): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT id
      FROM folders
      WHERE id = ${folderId}::uuid
        AND workspace_id = ${workspaceId}::uuid
        AND deleted_at IS NULL
      UNION ALL
      SELECT folders.id
      FROM folders
      INNER JOIN descendants ON folders.parent_id = descendants.id
      WHERE folders.workspace_id = ${workspaceId}::uuid
        AND folders.deleted_at IS NULL
    )
    SELECT id
    FROM descendants
    WHERE id = ${candidateId}::uuid
    LIMIT 1
  `)

  return readExecuteIds(rows).length > 0
}

function readExecuteIds(result: unknown): string[] {
  const rows = Array.isArray(result)
    ? result
    : result &&
        typeof result === "object" &&
        "rows" in result &&
        Array.isArray(result.rows)
      ? result.rows
      : []

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || !("id" in row)) return []
    return typeof row.id === "string" ? [row.id] : []
  })
}

function succeed<Value>(value: Value): FolderWriteResult<Value> {
  return { ok: true, value }
}

function fail(error: FolderMutationError): FolderWriteResult<never> {
  return { ok: false, error }
}

export const folderRepository: FolderRepository = {
  listForWorkspaceEffect,
  findInWorkspaceEffect,
  createFolderEffect,
  renameFolderEffect,
  moveFolderEffect,
  softDeleteFolderEffect,
  resolveDescendantSourceIdsEffect,
}
