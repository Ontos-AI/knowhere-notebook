import Knowhere from "@ontos-ai/knowhere-sdk"
import { logger } from "@/lib/logger"

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

export type KnowhereNamespace = {
  readonly namespace: string
  readonly documentCount: number
}

/**
 * List all namespaces from the Knowhere API.
 * The SDK does not expose this endpoint, so we call it directly.
 */
export async function listKnowhereNamespaces(
  apiKey: string,
): Promise<readonly KnowhereNamespace[]> {
  const baseURL = process.env.KNOWHERE_BASE_URL ?? "https://api.knowhere.com"
  const response = await fetch(`${baseURL}/v1/documents/namespaces`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    logger.warn("knowhere: listNamespaces failed", {
      status: response.status,
    })
    return []
  }
  const data = (await response.json()) as unknown
  const items = Array.isArray(data)
    ? data
    : (data as { namespaces?: unknown[] })?.namespaces
  if (!Array.isArray(items)) return []
  return items
    .filter(
      (item): item is { namespace: string; document_count?: number; documentCount?: number } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { namespace?: unknown }).namespace === "string",
    )
    .map((item) => ({
      namespace: item.namespace,
      documentCount: item.documentCount ?? item.document_count ?? 0,
    }))
}

/**
 * Probe whether an API key is valid by listing namespaces. 200 → valid;
 * 401/403 (or any failure) → invalid. Used when a user adds a key.
 */
export async function validateKnowhereApiKey(
  apiKey: string,
): Promise<boolean> {
  const baseURL = process.env.KNOWHERE_BASE_URL ?? "https://api.knowhere.com"
  try {
    const response = await fetch(`${baseURL}/v1/documents/namespaces`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    return response.ok
  } catch {
    return false
  }
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
