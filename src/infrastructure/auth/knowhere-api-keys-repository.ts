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
import { maskApiKey } from "@/integrations/knowhere-keys"

export type StoredKnowhereApiKey = {
  readonly id: string
  readonly userId: string
  readonly label: string
  readonly keyMask: string
  readonly createdAt: Date
}

type KnowhereApiKeysRepository = {
  readonly createForUserEffect: (input: {
    readonly userId: string
    readonly label: string
    readonly apiKey: string
  }) => Effect.Effect<KnowhereApiKey, never, DbClient>
  readonly listByUserEffect: (
    userId: string,
  ) => Effect.Effect<StoredKnowhereApiKey[], never, DbClient>
  readonly findByIdAndUserEffect: (
    id: string,
    userId: string,
  ) => Effect.Effect<StoredKnowhereApiKey | null, never, DbClient>
  readonly softDeleteEffect: (
    id: string,
    userId: string,
  ) => Effect.Effect<void, never, DbClient>
  readonly getActiveForWorkspaceEffect: (
    workspaceId: string,
  ) => Effect.Effect<StoredKnowhereApiKey | null, never, DbClient>
  readonly firstForUserEffect: (
    userId: string,
  ) => Effect.Effect<StoredKnowhereApiKey | null, never, DbClient>
  readonly setActiveEffect: (
    workspaceId: string,
    apiKeyId: string | null,
  ) => Effect.Effect<void, never, DbClient>
  readonly clearActiveForKeyEffect: (
    apiKeyId: string,
    userId: string,
  ) => Effect.Effect<void, never, DbClient>
  readonly decryptStoredEffect: (
    stored: StoredKnowhereApiKey,
  ) => Effect.Effect<string, never, DbClient>
}

const toStored = (row: KnowhereApiKey): StoredKnowhereApiKey => ({
  id: row.id,
  userId: row.userId,
  label: row.label,
  keyMask: row.keyMask,
  createdAt: row.createdAt,
})

const createForUserEffect: KnowhereApiKeysRepository["createForUserEffect"] = (
  input,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const encrypted = encryptSecret(input.apiKey)
    const rows = yield* Effect.promise(() =>
      db
        .insert(knowhereApiKeys)
        .values({
          userId: input.userId,
          label: input.label,
          keyMask: maskApiKey(input.apiKey),
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

const listByUserEffect: KnowhereApiKeysRepository["listByUserEffect"] = (
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(knowhereApiKeys)
        .where(
          and(
            eq(knowhereApiKeys.userId, userId),
            isNull(knowhereApiKeys.deletedAt),
          ),
        )
        .orderBy(knowhereApiKeys.createdAt),
    )
    return rows.map(toStored)
  })

const findByIdAndUserEffect: KnowhereApiKeysRepository["findByIdAndUserEffect"] =
  (id: string, userId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const rows = yield* Effect.promise(() =>
        db
          .select()
          .from(knowhereApiKeys)
          .where(
            and(
              eq(knowhereApiKeys.id, id),
              eq(knowhereApiKeys.userId, userId),
              isNull(knowhereApiKeys.deletedAt),
            ),
          )
          .limit(1),
      )
      return rows[0] ? toStored(rows[0]) : null
    })

const softDeleteEffect: KnowhereApiKeysRepository["softDeleteEffect"] = (
  id: string,
  userId: string,
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
            eq(knowhereApiKeys.userId, userId),
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
              isNull(knowhereApiKeys.deletedAt),
            ),
          )
          .limit(1),
      )
      return rows[0] ? toStored(rows[0]) : null
    })

const firstForUserEffect: KnowhereApiKeysRepository["firstForUserEffect"] = (
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(knowhereApiKeys)
        .where(
          and(
            eq(knowhereApiKeys.userId, userId),
            isNull(knowhereApiKeys.deletedAt),
          ),
        )
        .orderBy(knowhereApiKeys.createdAt)
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

const clearActiveForKeyEffect: KnowhereApiKeysRepository["clearActiveForKeyEffect"] =
  (apiKeyId: string, userId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      yield* Effect.promise(() =>
        db
          .update(workspaces)
          .set({ activeKnowhereApiKeyId: null })
          .where(
            and(
              eq(workspaces.userId, userId),
              eq(workspaces.activeKnowhereApiKeyId, apiKeyId),
            ),
          ),
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
        .where(eq(knowhereApiKeys.id, stored.id))
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
  createForUserEffect,
  listByUserEffect,
  findByIdAndUserEffect,
  softDeleteEffect,
  getActiveForWorkspaceEffect,
  firstForUserEffect,
  setActiveEffect,
  clearActiveForKeyEffect,
  decryptStoredEffect,
}
