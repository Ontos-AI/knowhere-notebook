import "server-only"

import { randomUUID } from "node:crypto"

import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { DbClient } from "@/infrastructure/db"
import { parsedDocumentSyncLeases } from "@/infrastructure/db/schema"

type SyncCapacityPolicy = {
  readonly globalActiveLimit: number
  readonly workspaceActiveLimit: number
  readonly documentActiveLimit: number
  readonly waitSeconds: number
}

type ActiveSyncCounts = {
  readonly globalActive: number
  readonly workspaceActive: number
  readonly documentActive: number
}

type SyncCapacityDenialReason = "global" | "workspace" | "document"

type AcquireSyncLeaseInput = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly documentId: string
  readonly revisionKey?: string
  readonly policy?: SyncCapacityPolicy
}

type AcquireSyncLeaseResult =
  | {
      readonly kind: "acquired"
      readonly leaseToken: string
      readonly activeCounts: ActiveSyncCounts
    }
  | {
      readonly kind: "capacity-full"
      readonly reason: SyncCapacityDenialReason
      readonly waitSeconds: number
      readonly activeCounts: ActiveSyncCounts
    }
  | {
      readonly kind: "source-missing"
    }

type ReleaseSyncLeaseInput = {
  readonly leaseToken: string
  readonly releaseReason: SyncLeaseReleaseReason
}

type SyncLeaseReleaseReason = "completed" | "incomplete" | "failed"

type AcquireSyncLeaseRow = {
  readonly leaseId: string | null
  readonly leaseToken: string | null
  readonly hasSource: boolean
  readonly globalActive: number | string
  readonly workspaceActive: number | string
  readonly documentActive: number | string
}

type RawRowsResult<Row> =
  | readonly Row[]
  | {
      readonly rows: readonly Row[]
    }

const defaultGlobalActiveLimit: number = 100
const defaultWorkspaceActiveLimit: number = 5
const defaultDocumentActiveLimit: number = 1
const defaultWaitSeconds: number = 60
const leaseDurationSeconds: number = 10 * 60

const capacityLockClassId: number = 24_071_105
const capacityLockObjectId: number = 2_607_198

function readPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SyncCapacityPolicy {
  return {
    globalActiveLimit: readPositiveIntegerEnv(
      "SYNC_GLOBAL_ACTIVE_LIMIT",
      defaultGlobalActiveLimit,
      env,
    ),
    workspaceActiveLimit: readPositiveIntegerEnv(
      "SYNC_WORKSPACE_ACTIVE_LIMIT",
      defaultWorkspaceActiveLimit,
      env,
    ),
    documentActiveLimit: readPositiveIntegerEnv(
      "SYNC_DOCUMENT_ACTIVE_LIMIT",
      defaultDocumentActiveLimit,
      env,
    ),
    waitSeconds: readPositiveIntegerEnv(
      "SYNC_WAIT_SECONDS",
      defaultWaitSeconds,
      env,
    ),
  }
}

function readPositiveIntegerEnv(
  name: string,
  defaultValue: number,
  env: Readonly<Record<string, string | undefined>>,
): number {
  const rawValue = env[name]
  if (!rawValue) return defaultValue

  const value = Number(rawValue)
  if (!Number.isInteger(value) || value < 1) return defaultValue

  return value
}

function selectDenialReason(
  counts: ActiveSyncCounts,
  policy: SyncCapacityPolicy,
): SyncCapacityDenialReason | null {
  if (counts.documentActive >= policy.documentActiveLimit) return "document"
  if (counts.workspaceActive >= policy.workspaceActiveLimit) return "workspace"
  if (counts.globalActive >= policy.globalActiveLimit) return "global"

  return null
}

const acquireEffect = (
  input: AcquireSyncLeaseInput,
): Effect.Effect<AcquireSyncLeaseResult, never, DbClient> =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const policy = input.policy ?? readPolicy()
    const leaseToken = randomUUID()
    const result = yield* Effect.promise(() =>
      db.execute<AcquireSyncLeaseRow>(sql`
        WITH lock AS (
          SELECT pg_advisory_xact_lock(${capacityLockClassId}, ${capacityLockObjectId})
        ),
        expired AS (
          UPDATE parsed_document_sync_leases
          SET released_at = now(),
              release_reason = 'expired',
              updated_at = now()
          WHERE released_at IS NULL
            AND expires_at <= now()
          RETURNING id
        ),
        counts AS (
          SELECT
            EXISTS (
              SELECT 1
              FROM sources
              WHERE id = ${input.sourceId}::uuid
                AND workspace_id = ${input.workspaceId}::uuid
                AND deleted_at IS NULL
            ) AS "hasSource",
            (
              SELECT count(*)::int
              FROM parsed_document_sync_leases
              WHERE released_at IS NULL
                AND expires_at > now()
            ) AS "globalActive",
            (
              SELECT count(*)::int
              FROM parsed_document_sync_leases
              WHERE workspace_id = ${input.workspaceId}::uuid
                AND released_at IS NULL
                AND expires_at > now()
            ) AS "workspaceActive",
            (
              SELECT count(*)::int
              FROM parsed_document_sync_leases
              WHERE document_id = ${input.documentId}
                AND released_at IS NULL
                AND expires_at > now()
            ) AS "documentActive"
          FROM lock
        ),
        inserted AS (
          INSERT INTO parsed_document_sync_leases (
            workspace_id,
            source_id,
            document_id,
            revision_key,
            lease_token,
            expires_at
          )
          SELECT
            ${input.workspaceId}::uuid,
            ${input.sourceId}::uuid,
            ${input.documentId},
            ${input.revisionKey ?? null},
            ${leaseToken},
            now() + (${leaseDurationSeconds} * interval '1 second')
          FROM counts
          WHERE "hasSource"
            AND "globalActive" < ${policy.globalActiveLimit}
            AND "workspaceActive" < ${policy.workspaceActiveLimit}
            AND "documentActive" < ${policy.documentActiveLimit}
          RETURNING id AS "leaseId", lease_token AS "leaseToken"
        )
        SELECT
          (SELECT "leaseId" FROM inserted) AS "leaseId",
          (SELECT "leaseToken" FROM inserted) AS "leaseToken",
          counts."hasSource",
          counts."globalActive",
          counts."workspaceActive",
          counts."documentActive"
        FROM counts
      `),
    )
    const row = getFirstRow(getRawRows(result))
    if (!row) return { kind: "source-missing" }
    if (!row.hasSource) return { kind: "source-missing" }

    const activeCounts = normalizeActiveCounts(row)
    if (row.leaseToken) {
      return {
        kind: "acquired",
        leaseToken: row.leaseToken,
        activeCounts,
      }
    }

    return {
      kind: "capacity-full",
      reason: selectDenialReason(activeCounts, policy) ?? "global",
      waitSeconds: policy.waitSeconds,
      activeCounts,
    }
  })

const releaseEffect = (
  input: ReleaseSyncLeaseInput,
): Effect.Effect<void, never, DbClient> =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() =>
      db
        .update(parsedDocumentSyncLeases)
        .set({
          releasedAt: sql`now()`,
          releaseReason: input.releaseReason,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(parsedDocumentSyncLeases.leaseToken, input.leaseToken),
            isNull(parsedDocumentSyncLeases.releasedAt),
          ),
        ),
    )
  })

function normalizeActiveCounts(row: AcquireSyncLeaseRow): ActiveSyncCounts {
  return {
    globalActive: normalizeCount(row.globalActive),
    workspaceActive: normalizeCount(row.workspaceActive),
    documentActive: normalizeCount(row.documentActive),
  }
}

function normalizeCount(value: number | string): number {
  return typeof value === "number" ? value : Number(value)
}

function getRawRows<Row>(value: RawRowsResult<Row>): readonly Row[] {
  if (isReadonlyArray(value)) return value
  return value.rows
}

function getFirstRow<Row>(rows: readonly Row[]): Row | undefined {
  return rows[0]
}

function isReadonlyArray<Row>(
  value: RawRowsResult<Row>,
): value is readonly Row[] {
  return Array.isArray(value)
}

async function acquire(
  input: AcquireSyncLeaseInput,
): Promise<AcquireSyncLeaseResult> {
  return databaseRuntime.runPromise(acquireEffect(input))
}

async function release(input: ReleaseSyncLeaseInput): Promise<void> {
  await databaseRuntime.runPromise(releaseEffect(input))
}

export const parsedDocumentSyncCapacityGuard = {
  acquire,
  readPolicy,
  release,
  selectDenialReason,
}
