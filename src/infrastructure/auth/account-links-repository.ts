import "server-only"

import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import { accountLinks, type AccountLink } from "@/infrastructure/db/schema"

type AccountLinksRepository = {
  readonly findByUserIdAndProviderEffect: (
    userId: string,
    provider: string,
  ) => Effect.Effect<AccountLink | null, never, DbClient>
  readonly findByProviderAndProviderUserIdEffect: (
    provider: string,
    providerUserId: string,
  ) => Effect.Effect<AccountLink | null, never, DbClient>
  readonly insertEffect: (input: {
    readonly userId: string
    readonly provider: string
    readonly providerUserId: string | null
    readonly passwordHash: string | null
  }) => Effect.Effect<AccountLink, never, DbClient>
}

const findByUserIdAndProviderEffect: AccountLinksRepository["findByUserIdAndProviderEffect"] =
  (userId: string, provider: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const row = yield* Effect.promise(() =>
        db
          .select()
          .from(accountLinks)
          .where(
            and(
              eq(accountLinks.userId, userId),
              eq(accountLinks.provider, provider),
            ),
          )
          .limit(1),
      )
      return row[0] ?? null
    })

const findByProviderAndProviderUserIdEffect: AccountLinksRepository["findByProviderAndProviderUserIdEffect"] =
  (provider: string, providerUserId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const row = yield* Effect.promise(() =>
        db
          .select()
          .from(accountLinks)
          .where(
            and(
              eq(accountLinks.provider, provider),
              eq(accountLinks.providerUserId, providerUserId),
            ),
          )
          .limit(1),
      )
      return row[0] ?? null
    })

const insertEffect: AccountLinksRepository["insertEffect"] = (input) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const rows = yield* Effect.promise(() =>
      db.insert(accountLinks).values(input).returning(),
    )
    const row = rows[0]
    if (!row) {
      return yield* Effect.die(
        new Error("account_links: insert returned no row."),
      )
    }
    return row
  })

export const accountLinksRepository: AccountLinksRepository = {
  findByUserIdAndProviderEffect,
  findByProviderAndProviderUserIdEffect,
  insertEffect,
}
