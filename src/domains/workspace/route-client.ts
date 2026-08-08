import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { Effect } from "effect"

type WorkspaceRouteClientModule = {
  readonly deleteJson: <T>(url: string, body: unknown) => Promise<T>
  readonly deleteJsonWithStatus: <T>(
    url: string,
    body: unknown,
  ) => Promise<JsonRouteResponse<T>>
  readonly getJson: <T>(url: string) => Promise<T>
  readonly postJson: <T>(url: string, body: unknown) => Promise<T>
  readonly postJsonWithStatus: <T>(
    url: string,
    body: unknown,
  ) => Promise<JsonRouteResponse<T>>
  readonly postFormData: <T>(url: string, body: FormData) => Promise<T>
  readonly postFormDataWithStatus: <T>(
    url: string,
    body: FormData,
  ) => Promise<JsonRouteResponse<T>>
  readonly patchJson: <T>(url: string, body: unknown) => Promise<T>
  readonly patchJsonWithStatus: <T>(
    url: string,
    body: unknown,
  ) => Promise<JsonRouteResponse<T>>
}

type JsonRouteResponse<T> = {
  readonly status: number
  readonly body: T
}

type JsonRequestInput = {
  readonly method: "DELETE" | "GET" | "PATCH" | "POST"
  readonly url: string
  readonly body?: unknown
}

async function deleteJson<T>(url: string, body: unknown): Promise<T> {
  return (await requestJson<T>({ method: "DELETE", url, body })).body
}

async function getJson<T>(url: string): Promise<T> {
  return (await requestJson<T>({ method: "GET", url })).body
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return (await postJsonWithStatus<T>(url, body)).body
}

function postJsonWithStatus<T>(
  url: string,
  body: unknown,
): Promise<JsonRouteResponse<T>> {
  return requestJson<T>({ method: "POST", url, body })
}

async function postFormData<T>(url: string, body: FormData): Promise<T> {
  return (await postFormDataWithStatus<T>(url, body)).body
}

function postFormDataWithStatus<T>(
  url: string,
  body: FormData,
): Promise<JsonRouteResponse<T>> {
  return Effect.runPromise(
    requestFormDataEffect<T>(url, body).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  )
}

function requestFormDataEffect<T>(
  url: string,
  body: FormData,
): Effect.Effect<JsonRouteResponse<T>, unknown, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const request = yield* buildFormDataRequest(url, body)
    const response = yield* HttpClient.execute(request)
    const responseBody: unknown = yield* response.json

    return {
      status: response.status,
      body: responseBody as T,
    }
  })
}

function buildFormDataRequest(url: string, body: FormData) {
  return Effect.succeed(
    HttpClientRequest.post(resolveSameOriginUrl(url)).pipe(
      HttpClientRequest.setHeaders({ Accept: "application/json" }),
      HttpClientRequest.bodyFormData(body),
    ),
  )
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  return (await patchJsonWithStatus<T>(url, body)).body
}

function patchJsonWithStatus<T>(
  url: string,
  body: unknown,
): Promise<JsonRouteResponse<T>> {
  return requestJson<T>({ method: "PATCH", url, body })
}

function deleteJsonWithStatus<T>(
  url: string,
  body: unknown,
): Promise<JsonRouteResponse<T>> {
  return requestJson<T>({ method: "DELETE", url, body })
}

function requestJson<T>(
  input: JsonRequestInput,
): Promise<JsonRouteResponse<T>> {
  return Effect.runPromise(
    requestJsonEffect<T>(input).pipe(Effect.provide(FetchHttpClient.layer)),
  )
}

function requestJsonEffect<T>(
  input: JsonRequestInput,
): Effect.Effect<JsonRouteResponse<T>, unknown, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const request = yield* buildRequest(input)
    const response = yield* HttpClient.execute(request)
    const body: unknown = yield* response.json

    return {
      status: response.status,
      body: body as T,
    }
  })
}

function buildRequest(input: JsonRequestInput) {
  const url = resolveSameOriginUrl(input.url)
  if (input.method === "GET") {
    return Effect.succeed(HttpClientRequest.get(url))
  }
  if (input.method === "DELETE") {
    return HttpClientRequest.del(url).pipe(HttpClientRequest.bodyJson(input.body))
  }
  if (input.method === "PATCH") {
    return HttpClientRequest.patch(url).pipe(
      HttpClientRequest.bodyJson(input.body),
    )
  }
  return HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(input.body))
}

function resolveSameOriginUrl(path: string): string {
  const origin = globalThis.location?.origin
  return new URL(path, origin ?? "http://localhost").toString()
}

export const workspaceRouteClient: WorkspaceRouteClientModule = {
  deleteJson,
  deleteJsonWithStatus,
  getJson,
  postJson,
  postJsonWithStatus,
  postFormData,
  postFormDataWithStatus,
  patchJson,
  patchJsonWithStatus,
}
