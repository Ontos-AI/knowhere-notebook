import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

/**
 * Server-side Drizzle client for Neon Postgres.
 *
 * `server-only` ensures a build-time error if this module is ever imported
 * from a client component — the connection string must never ship to the
 * browser bundle.
 *
 * The neon-http driver keeps the schema portable: it speaks plain Postgres
 * wire protocol, so switching the connection string to an AWS Aurora
 * serverless endpoint requires no code changes.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required. Set it in .env.local (local dev) or the " +
      "Vercel project env (prod).",
  );
}

export const db = drizzle(neon(url), { schema });
export type Db = typeof db;
