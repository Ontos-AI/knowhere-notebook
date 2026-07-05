import Knowhere from "@ontos-ai/knowhere-sdk"
import type {
  Knowledge,
  ParsedDocumentStorageLimits,
  ParsedDocumentSyncScheduler,
} from "@ontos-ai/knowhere-sdk"
import { logger } from "@/lib/logger"
import { BlobParsedDocumentStorage } from "@/domains/sources/parsed-document-blob-storage"

/**
 * Vercel-safe defaults for parsed-document reads and background sync. Each read
 * miss and each background sync step is bounded by page count and a deadline so
 * a single serverless invocation stays well under the platform ceiling; the
 * SDK returns `completed:false` and the caller re-enqueues to continue.
 */
const defaultParsedStorageLimits: ParsedDocumentStorageLimits = {
  chunkPageSize: 200,
  remotePageSize: 100,
  maxPagesPerSync: 10,
  maxAssetsPerSync: 20,
  syncDeadlineMs: 8000,
  grepMaxPages: 50,
  grepDeadlineMs: 8000,
  outlineMaxPages: 50,
  outlineDeadlineMs: 8000,
}

type ParsedStorageOptions = {
  readonly workspaceId: string
  readonly scheduler?: ParsedDocumentSyncScheduler
  readonly limits?: ParsedDocumentStorageLimits
}

/**
 * Create a Knowhere client with the given API key.
 * Use for per-request clients created from Dashboard-issued JWTs.
 */
export function makeKnowhereClient(apiKey: string): Knowhere {
  const options: ConstructorParameters<typeof Knowhere>[0] = {
    apiKey,
    baseURL: process.env.KNOWHERE_BASE_URL,
  }
  const client = new Knowhere(options)
  return wrapKnowhereClient(client)
}

/**
 * Create a Knowhere client plus a `Knowledge` configured with a Vercel-Blob
 * `ParsedDocumentStorage`. Reads through `knowledge` serve from Blob first and
 * fall back to Knowhere remote transparently; the `scheduler` (when provided)
 * backfills Blob in the background. Use `client` for retrieval/documents/jobs.
 *
 * `withParsedStorage` is invoked through the logging Proxy so `this` binds to
 * the real Knowledge; the returned Knowledge wraps the unwrapped inner client
 * (its internal `documents.listChunks` calls are not logged, which is fine).
 */
export function makeKnowhereClientWithParsedStorage(
  apiKey: string,
  options: ParsedStorageOptions,
): { readonly client: Knowhere; readonly knowledge: Knowledge } {
  const client = makeKnowhereClient(apiKey)
  const knowledge = client.knowledge.withParsedStorage({
    storage: new BlobParsedDocumentStorage({ workspaceId: options.workspaceId }),
    scheduler: options.scheduler,
    limits: options.limits ?? defaultParsedStorageLimits,
  })
  return { client, knowledge }
}

function wrapKnowhereClient(client: Knowhere): Knowhere {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value === "function") {
        return createLoggingMethod(String(prop), value, [], target)
      }
      if (value !== null && typeof value === "object") {
        return createLoggingNamespace(String(prop), value)
      }
      return value
    },
  }) as Knowhere
}

function createLoggingNamespace(
  namespace: string,
  obj: object,
): object {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value === "function") {
        return createLoggingMethod(prop, value, [namespace], target)
      }
      return value
    },
  })
}

function createLoggingMethod(
  name: string | symbol,
  fn: (...args: unknown[]) => unknown,
  path: string[],
  thisArg: object,
): (...args: unknown[]) => unknown {
  const fullPath = [...path, String(name)].join(".")

  return (...args: unknown[]) => {
    const start = Date.now()
    logger.info(`knowhere: ${fullPath}`, { args: safeArgs(args) })

    const result = Reflect.apply(fn, thisArg, args) as unknown
    if (!isPromise(result)) return result

    return result.then(
      (value: unknown) => {
        logger.info(`knowhere: ${fullPath} ok`, {
          durationMs: Date.now() - start,
        })
        return value
      },
      (error: unknown) => {
        logger.error(`knowhere: ${fullPath} failed`, {
          durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      },
    )
  }
}

function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Promise<unknown>).then === "function"
  )
}

function safeArgs(args: unknown[]): unknown {
  try {
    return JSON.parse(JSON.stringify(args))
  } catch {
    return args.map((a) => (typeof a === "string" ? a : "[non-serializable]"))
  }
}
