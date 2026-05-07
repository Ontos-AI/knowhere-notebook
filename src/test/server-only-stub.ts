/**
 * Test-only stub for the `server-only` package.
 *
 * `server-only` is a build-time guard: it throws if a module is imported
 * from a client bundle. Under Vitest we're always in Node, so the guard
 * has nothing to check — this file short-circuits it to a noop.
 */
export {};
