import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import { users, type User } from "@/infrastructure/db/schema"

type UsersRepository = {
  readonly findByEmailEffect: (
    email: string,
  ) => Effect.Effect<User | null, never, DbClient>
  readonly findByIdEffect: (
    id: string,
  ) => Effect.Effect<User | null, never, DbClient>
  readonly insertEffect: (
    input: { readonly email: string; readonly name: string | null },
  ) => Effect.Effect<User, never, DbClient>
}

const findByEmailEffect: UsersRepository["findByEmailEffect"] = (email: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1),
    )
    return row[0] ?? null
  })

const findByIdEffect: UsersRepository["findByIdEffect"] = (id: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1),
    )
    return row[0] ?? null
  })

const insertEffect: UsersRepository["insertEffect"] = (input) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const rows = yield* Effect.promise(() =>
      db.insert(users).values(input).returning(),
    )
    const row = rows[0]
    if (!row) {
      return yield* Effect.die(new Error("users: insert returned no row."))
    }
    return row
  })

export const usersRepository: UsersRepository = {
  findByEmailEffect,
  findByIdEffect,
  insertEffect,
}
