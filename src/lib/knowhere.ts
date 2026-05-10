import { Context } from "effect"
import Knowhere from "@ontos-ai/knowhere-sdk"
import { logger } from "./logger"

/**
 * Server-side Knowhere client Effect service.
 */
export class KnowhereClient extends Context.Tag("@knowhere/KnowhereClient")<
  KnowhereClient,
  Knowhere
>() { }

/**
 * Create a Knowhere client with the given API key.
 * Use for per-request clients created from Dashboard-issued JWTs.
 */
export function makeKnowhereClient(apiKey: string): Knowhere {
  const client = new Knowhere({ apiKey, baseURL: process.env.KNOWHERE_BASE_URL })
  return wrapKnowhereClient(client)
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
