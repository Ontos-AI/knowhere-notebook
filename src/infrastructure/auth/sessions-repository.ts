import "server-only"

import { and, eq, gt, lt } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import { sessions, type Session } from "@/infrastructure/db/schema"

type SessionsRepository = {
  readonly findByIdEffect: (
    id: string,
  ) => Effect.Effect<Session | null, never, DbClient>
  readonly createEffect: (input: {
    readonly userId: string
    readonly expiresAt: Date
  }) => Effect.Effect<Session, never, DbClient>
  readonly deleteByIdEffect: (id: string) => Effect.Effect<void, never, DbClient>
  readonly deleteExpiredEffect: () => Effect.Effect<void, never, DbClient>
}

const findByIdEffect: SessionsRepository["findByIdEffect"] = (id: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
        .limit(1),
    )
    return row[0] ?? null
  })

const createEffect: SessionsRepository["createEffect"] = (input) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const rows = yield* Effect.promise(() =>
      db.insert(sessions).values(input).returning(),
    )
    const row = rows[0]
    if (!row) {
      return yield* Effect.die(new Error("sessions: insert returned no row."))
    }
    return row
  })

const deleteByIdEffect: SessionsRepository["deleteByIdEffect"] = (id: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() => db.delete(sessions).where(eq(sessions.id, id)))
  })

const deleteExpiredEffect: SessionsRepository["deleteExpiredEffect"] = () =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() =>
      db.delete(sessions).where(lt(sessions.expiresAt, new Date())),
    )
  })

export const sessionsRepository: SessionsRepository = {
  findByIdEffect,
  createEffect,
  deleteByIdEffect,
  deleteExpiredEffect,
}
