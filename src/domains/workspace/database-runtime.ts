import "server-only"

import { Effect, ManagedRuntime } from "effect"

import { DbClient, dbLayer } from "@/infrastructure/db"

let runtime: ManagedRuntime.ManagedRuntime<DbClient, never> | null = null

function getRuntime(): ManagedRuntime.ManagedRuntime<DbClient, never> {
  if (!runtime) runtime = ManagedRuntime.make(dbLayer)
  return runtime
}

export const databaseRuntime = {
  runPromise<Value>(
    effect: Effect.Effect<Value, never, DbClient>,
  ): Promise<Value> {
    return getRuntime().runPromise(effect)
  },
} as const
