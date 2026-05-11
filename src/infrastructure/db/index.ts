import "server-only"

import { neon, type NeonQueryFunction } from "@neondatabase/serverless"
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http"
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { Context, Layer } from "effect"

import * as schema from "./schema"

/**
 * Server-side Drizzle client for Postgres.
 *
 * `server-only` ensures a build-time error if this module is ever imported
 * from a client component — the connection string must never ship to the
 * browser bundle.
 *
 * Driver selection:
 *   - `DATABASE_DRIVER=pg` uses the plain `postgres-js` driver. Required
 *     for a Docker Postgres / any non-Neon host in local dev or CI.
 *   - Default (`neon`) uses the Neon serverless HTTP driver. Required in
 *     Vercel prod where we target Neon via the Marketplace integration.
 */

type Schema = typeof schema
export type Db = NeonHttpDatabase<Schema>

/**
 * Effect service tag for the Drizzle database client.
 * Use `yield* DbClient` in Effect code; provide `dbLayer` at the boundary.
 */
export class DbClient extends Context.Tag("@knowhere/DbClient")<
  DbClient,
  Db
>() {}

/** Production database layer backed by DATABASE_URL. */
export const dbLayer = Layer.sync(DbClient, () => makeDb())

// ---- internals ---------------------------------------------------------

function makeDb(): Db {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Set it in .env.local (local dev) or the " +
        "Vercel project env (prod).",
    )
  }

  const driver = (process.env.DATABASE_DRIVER ?? "neon").toLowerCase()

  if (driver === "pg") {
    return drizzlePg(postgres(url, { prepare: false }), {
      schema,
    }) as unknown as Db
  }
  if (driver === "neon") {
    const client = neon(url) as NeonQueryFunction<false, false>
    return drizzleNeon(client, { schema })
  }
  throw new Error(
    `DATABASE_DRIVER must be "neon" (default) or "pg"; got ${JSON.stringify(driver)}.`,
  )
}

