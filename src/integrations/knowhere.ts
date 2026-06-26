import Knowhere from "@ontos-ai/knowhere-sdk"
import { logger } from "@/lib/logger"

export type KnowhereActiveDocumentJob = {
  readonly jobId: string
  readonly documentId?: string | null
  readonly namespace: string
  readonly status: string
  readonly sourceType?: string | null
  readonly sourceFileName?: string | null
  readonly documentMetadata?: Record<string, unknown>
  readonly createdAt?: Date | string | null
  readonly updatedAt?: Date | string | null
}

export type KnowhereDocumentListParams = {
  readonly namespace?: string
  readonly includeActiveJobs?: boolean
}

export type KnowhereDocumentListResponse = Awaited<
  ReturnType<Knowhere["documents"]["list"]>
> & {
  readonly activeJobs?: readonly KnowhereActiveDocumentJob[]
}

export type NotebookKnowhereClient = Knowhere & {
  readonly documents: Omit<Knowhere["documents"], "list"> & {
    list(
      params?: KnowhereDocumentListParams,
    ): Promise<KnowhereDocumentListResponse>
  }
}

type SdkHttpClient = {
  readonly get: (
    path: string,
    config?: {
      readonly params?: Readonly<Record<string, unknown>>
    },
  ) => Promise<KnowhereDocumentListResponse>
}

/**
 * Create a Knowhere client with the given API key.
 * Use for per-request clients created from Dashboard-issued JWTs.
 */
export function makeKnowhereClient(apiKey: string): NotebookKnowhereClient {
  const client = new Knowhere({ apiKey, baseURL: process.env.KNOWHERE_BASE_URL })
  return wrapKnowhereClient(addNotebookDocumentListSupport(client))
}

function addNotebookDocumentListSupport(client: Knowhere): NotebookKnowhereClient {
  const documents = client.documents as NotebookKnowhereClient["documents"]
  const originalList = documents.list.bind(documents)

  documents.list = async (
    params?: KnowhereDocumentListParams,
  ): Promise<KnowhereDocumentListResponse> => {
    if (params?.includeActiveJobs !== true) {
      return originalList(params)
    }

    const httpClient = getSdkHttpClient(client)
    if (!httpClient) return originalList(params)

    return httpClient.get("/v1/documents", {
      params: toDocumentListQueryParams(params),
    })
  }

  return client as NotebookKnowhereClient
}

function getSdkHttpClient(client: Knowhere): SdkHttpClient | null {
  const candidate = (client as unknown as { readonly httpClient?: unknown })
    .httpClient
  if (!candidate || typeof candidate !== "object") return null

  const get = (candidate as { readonly get?: unknown }).get
  if (typeof get !== "function") return null

  return candidate as SdkHttpClient
}

function toDocumentListQueryParams(
  params: KnowhereDocumentListParams,
): Readonly<Record<string, unknown>> {
  return {
    ...(params.namespace ? { namespace: params.namespace } : {}),
    include_active_jobs: true,
  }
}

function wrapKnowhereClient(client: NotebookKnowhereClient): NotebookKnowhereClient {
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
  }) as NotebookKnowhereClient
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
