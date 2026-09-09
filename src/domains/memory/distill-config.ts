/**
 * Distill job defaults from the two-tier fluid-memory plan.
 * Tunable later; kept as named constants (not scattered literals).
 */

/** Process-local cooldown + QStash workflowRunId bucket width (mirrors reconcile). */
export const DISTILL_COOLDOWN_MS = 5 * 60_000

/** Capture may trigger distill once pending observations reach this count. */
export const DISTILL_MIN_PENDING = 8

/** Max pending rows claimed per distill run (oldest first). */
export const DISTILL_BATCH_MAX = 40

/** Lexical dedup candidates loaded per memory kind for one distill batch. */
export const DISTILL_DEDUP_CANDIDATES_PER_KIND = 8

/** Delete consumed observations older than this (retention sweep after distill). */
export const DISTILL_CONSUMED_RETENTION_MS = 30 * 24 * 60_000
