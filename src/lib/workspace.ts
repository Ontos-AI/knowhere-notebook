import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import { workspaces, type Workspace } from "./schema";

/**
 * Ensure a workspace exists for the given Dashboard user id.
 *
 * MVP model: one workspace per user. This runs on every authenticated
 * request that needs workspace context. It is idempotent:
 *   - First call inserts the row with a deterministic `namespace`
 *     derived from the generated UUID.
 *   - Every subsequent call is a single `SELECT ... WHERE user_id = $1`
 *     returning the existing row.
 *
 * The insert uses `ON CONFLICT (user_id) DO NOTHING` so concurrent first
 * calls from the same user race safely to the same row.
 */
export async function ensureWorkspace(userId: string): Promise<Workspace> {
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, userId))
    .limit(1);

  if (existing[0]) return existing[0];

  // Namespace is derived from a fresh UUID so it's guaranteed unique and
  // opaque to the browser. We insert + select-back so we see the actual
  // row regardless of who wins a race.
  const namespace = `notebook-${crypto.randomUUID()}`;
  await db
    .insert(workspaces)
    .values({ userId, namespace })
    .onConflictDoNothing({ target: workspaces.userId });

  const row = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, userId))
    .limit(1);

  if (!row[0]) {
    // This should be impossible — the ON CONFLICT path guarantees a row
    // exists after the insert completes. Surface loudly if it ever does.
    throw new Error(
      `ensureWorkspace: workspace row not found for user ${userId} after ` +
        "upsert. Check that the workspaces.user_id unique index exists.",
    );
  }

  return row[0];
}

/**
 * Smoke test for the Postgres connection. Used by the `db:ping` script
 * and the `/api/internal/health` route so we can verify the deploy
 * without needing a real user session.
 */
export async function pingDatabase(): Promise<void> {
  await db.execute(sql`select 1`);
}
