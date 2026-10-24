import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform"
import { Effect, Stream } from "effect"

import { knowhereDemoApi } from "./knowhere-demo"

const forwardedRequestHeaders: readonly string[] = ["range", "if-range", "if-none-match", "if-modified-since"]
const forwardedResponseHeaders: readonly string[] = ["content-type", "content-disposition", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "retry-after"]

export function proxyKnowhereDemoFile(request: Request, path: string): Promise<Response> {
  return Effect.runPromise(Effect.gen(function* () {
    const incomingUrl: URL = new URL(request.url)
    const upstreamUrl: URL = new URL(knowhereDemoApi.resolveApiURL(path))
    const jobResultId: string | null = incomingUrl.searchParams.get("job_result_id")
    if (jobResultId) upstreamUrl.searchParams.set("job_result_id", jobResultId)
    const requestHeaders: Record<string, string> = {}
    for (const name of forwardedRequestHeaders) {
      const value: string | null = request.headers.get(name)
      if (value) requestHeaders[name] = value
    }
    const http = yield* HttpClient.HttpClient
    const response = yield* http.execute(HttpClientRequest.get(upstreamUrl.toString()).pipe(HttpClientRequest.setHeaders(requestHeaders)))
    const responseHeaders: Headers = new Headers({ "cache-control": "no-store" })
    for (const name of forwardedResponseHeaders) {
      const value: string | undefined = response.headers[name]
      if (value) responseHeaders.set(name, value)
    }
    if (!responseHeaders.has("content-disposition") && response.status >= 200 && response.status < 300) responseHeaders.set("content-disposition", "inline")
    const hasNoBody: boolean = response.status === 204 || response.status === 304
    return new Response(hasNoBody ? null : Stream.toReadableStream(response.stream), { status: response.status, headers: responseHeaders })
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, { cache: "no-store" }),
    Effect.catchAll(() => Effect.succeed(Response.json({ message: "Demo file could not be loaded right now." }, { status: 502 }))),
  ))
}
