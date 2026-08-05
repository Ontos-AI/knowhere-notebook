import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import {
  knowhereApiKeys,
  workspaces,
  type KnowhereApiKey,
} from "@/infrastructure/db/schema"
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto"

export type StoredKnowhereApiKey = {
  readonly id: string
  readonly workspaceId: string
  readonly label: string
  readonly createdAt: Date
}

export type DecryptedKnowhereApiKey = StoredKnowhereApiKey & {
  readonly apiKey: string
}

type KnowhereApiKeysRepository = {
  readonly createEffect: (input: {
    readonly workspaceId: string
    readonly label: string
    readonly apiKey: string
  }) => Effect.Effect<KnowhereApiKey, never, DbClient>
  readonly listByWorkspaceEffect: (
    workspaceId: string,
  ) => Effect.Effect<StoredKnowhereApiKey[], never, DbClient>
  readonly findByWorkspaceAndLabelEffect: (
    workspaceId: string,
    label: string,
  ) => Effect.Effect<StoredKnowhereApiKey | null, never, DbClient>
  readonly findByIdAndWorkspaceEffect: (
    id: string,
    workspaceId: string,
  ) => Effect.Effect<StoredKnowhereApiKey | null, never, DbClient>
  readonly softDeleteEffect: (
    id: string,
    workspaceId: string,
  ) => Effect.Effect<void, never, DbClient>
  readonly getActiveForWorkspaceEffect: (
    workspaceId: string,
  ) => Effect.Effect<StoredKnowhereApiKey | null, never, DbClient>
  readonly setActiveEffect: (
    workspaceId: string,
    apiKeyId: string | null,
  ) => Effect.Effect<void, never, DbClient>
  readonly decryptStoredEffect: (
    stored: StoredKnowhereApiKey,
  ) => Effect.Effect<string, never, DbClient>
}

const toStored = (row: KnowhereApiKey): StoredKnowhereApiKey => ({
  id: row.id,
  workspaceId: row.workspaceId,
  label: row.label,
  createdAt: row.createdAt,
})

const createEffect: KnowhereApiKeysRepository["createEffect"] = (input) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const encrypted = encryptSecret(input.apiKey)
    const rows = yield* Effect.promise(() =>
      db
        .insert(knowhereApiKeys)
        .values({
          workspaceId: input.workspaceId,
          label: input.label,
          cipherBlob: encrypted.cipherText,
          cipherNonce: encrypted.nonce,
        })
        .returning(),
    )
    const row = rows[0]
    if (!row) {
      return yield* Effect.die(
        new Error("knowhere_api_keys: insert returned no row."),
      )
    }
    return row
  })

const listByWorkspaceEffect: KnowhereApiKeysRepository["listByWorkspaceEffect"] =
  (workspaceId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const rows = yield* Effect.promise(() =>
        db
          .select()
          .from(knowhereApiKeys)
          .where(
            and(
              eq(knowhereApiKeys.workspaceId, workspaceId),
              isNull(knowhereApiKeys.deletedAt),
            ),
          )
          .orderBy(knowhereApiKeys.createdAt),
      )
      return rows.map(toStored)
    })

const findByWorkspaceAndLabelEffect: KnowhereApiKeysRepository["findByWorkspaceAndLabelEffect"] =
  (workspaceId: string, label: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const rows = yield* Effect.promise(() =>
        db
          .select()
          .from(knowhereApiKeys)
          .where(
            and(
              eq(knowhereApiKeys.workspaceId, workspaceId),
              eq(knowhereApiKeys.label, label),
              isNull(knowhereApiKeys.deletedAt),
            ),
          )
          .limit(1),
      )
      return rows[0] ? toStored(rows[0]) : null
    })

const findByIdAndWorkspaceEffect: KnowhereApiKeysRepository["findByIdAndWorkspaceEffect"] =
  (id: string, workspaceId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const rows = yield* Effect.promise(() =>
        db
          .select()
          .from(knowhereApiKeys)
          .where(
            and(
              eq(knowhereApiKeys.id, id),
              eq(knowhereApiKeys.workspaceId, workspaceId),
              isNull(knowhereApiKeys.deletedAt),
            ),
          )
          .limit(1),
      )
      return rows[0] ? toStored(rows[0]) : null
    })

const softDeleteEffect: KnowhereApiKeysRepository["softDeleteEffect"] = (
  id: string,
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() =>
      db
        .update(knowhereApiKeys)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(knowhereApiKeys.id, id),
            eq(knowhereApiKeys.workspaceId, workspaceId),
          ),
        ),
    )
  })

const getActiveForWorkspaceEffect: KnowhereApiKeysRepository["getActiveForWorkspaceEffect"] =
  (workspaceId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const workspaceRows = yield* Effect.promise(() =>
        db
          .select({ activeKnowhereApiKeyId: workspaces.activeKnowhereApiKeyId })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1),
      )
      const activeId = workspaceRows[0]?.activeKnowhereApiKeyId
      if (!activeId) return null

      const rows = yield* Effect.promise(() =>
        db
          .select()
          .from(knowhereApiKeys)
          .where(
            and(
              eq(knowhereApiKeys.id, activeId),
              eq(knowhereApiKeys.workspaceId, workspaceId),
              isNull(knowhereApiKeys.deletedAt),
            ),
          )
          .limit(1),
      )
      return rows[0] ? toStored(rows[0]) : null
    })

const setActiveEffect: KnowhereApiKeysRepository["setActiveEffect"] = (
  workspaceId: string,
  apiKeyId: string | null,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() =>
      db
        .update(workspaces)
        .set({ activeKnowhereApiKeyId: apiKeyId })
        .where(eq(workspaces.id, workspaceId)),
    )
  })

const decryptStoredEffect: KnowhereApiKeysRepository["decryptStoredEffect"] = (
  stored: StoredKnowhereApiKey,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(knowhereApiKeys)
        .where(
          and(
            eq(knowhereApiKeys.id, stored.id),
            eq(knowhereApiKeys.workspaceId, stored.workspaceId),
          ),
        )
        .limit(1),
    )
    const row = rows[0]
    if (!row) {
      return yield* Effect.die(
        new Error("knowhere_api_keys: row not found for decrypt."),
      )
    }
    return decryptSecret({
      cipherText: row.cipherBlob,
      nonce: row.cipherNonce,
    })
  })

export const knowhereApiKeysRepository: KnowhereApiKeysRepository = {
  createEffect,
  listByWorkspaceEffect,
  findByWorkspaceAndLabelEffect,
  findByIdAndWorkspaceEffect,
  softDeleteEffect,
  getActiveForWorkspaceEffect,
  setActiveEffect,
  decryptStoredEffect,
}
