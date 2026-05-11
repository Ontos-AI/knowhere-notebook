import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { Effect } from "effect"

type WorkspaceRouteClientModule = {
  readonly getJson: <T>(url: string) => Promise<T>
  readonly postJson: <T>(url: string, body: unknown) => Promise<T>
  readonly patchJson: <T>(url: string, body: unknown) => Promise<T>
}

const getJson = <T,>(url: string): Promise<T> =>
  Effect.runPromise(
    Effect.flatMap(
      HttpClientRequest.get(resolveSameOriginUrl(url)).pipe(HttpClient.execute),
      (response) => response.json,
    ).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

const postJson = <T,>(url: string, body: unknown): Promise<T> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.post(
        resolveSameOriginUrl(url),
      ).pipe(HttpClientRequest.bodyJson(body))
      const response = yield* HttpClient.execute(request)
      return yield* response.json
    }).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

const patchJson = <T,>(url: string, body: unknown): Promise<T> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.patch(
        resolveSameOriginUrl(url),
      ).pipe(HttpClientRequest.bodyJson(body))
      const response = yield* HttpClient.execute(request)
      return yield* response.json
    }).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

function resolveSameOriginUrl(path: string): string {
  const origin = globalThis.location?.origin
  return new URL(path, origin ?? "http://localhost").toString()
}

export const workspaceRouteClient: WorkspaceRouteClientModule = {
  getJson,
  postJson,
  patchJson,
}
