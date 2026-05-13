import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config for Neon Postgres.
 *
 * Usage:
 *   pnpm db:generate   # generate migration SQL from schema diff
 *   pnpm db:push       # apply schema to DATABASE_URL (dev / initial setup)
 *   pnpm db:migrate    # apply migrations to DATABASE_URL (prod deploy)
 */
export default defineConfig({
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
