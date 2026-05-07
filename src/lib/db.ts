import "server-only";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

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
 *
 * The Drizzle schema is identical for both drivers, so the only real
 * difference is the wire protocol. Switching to AWS Aurora Postgres is a
 * `DATABASE_DRIVER=pg` + `DATABASE_URL` swap — no code change.
 *
 * Type strategy: we expose `db` as the Neon-HTTP Drizzle type (the prod
 * driver). postgres-js implements the same Drizzle query builder API, so
 * under the hood the two clients are interchangeable at runtime; we just
 * cast the postgres-js branch at the boundary so call sites get consistent
 * types regardless of which driver is active.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required. Set it in .env.local (local dev) or the " +
      "Vercel project env (prod).",
  );
}

const driver = (process.env.DATABASE_DRIVER ?? "neon").toLowerCase();

type Schema = typeof schema;
export type Db = NeonHttpDatabase<Schema>;

function makeDb(): Db {
  if (driver === "pg") {
    return drizzlePg(postgres(url!, { prepare: false }), {
      schema,
    }) as unknown as Db;
  }
  if (driver === "neon") {
    const client = neon(url!) as NeonQueryFunction<false, false>;
    return drizzleNeon(client, { schema });
  }
  throw new Error(
    `DATABASE_DRIVER must be "neon" (default) or "pg"; got ${JSON.stringify(driver)}.`,
  );
}

export const db: Db = makeDb();
