import { HttpClientRequest } from "@effect/platform"

const EMPTY_JSON_BODY = "{}" as const
const JSON_CONTENT_TYPE = "application/json" as const

/**
 * Dashboard selects its RPC handler by inspecting `Content-Type`.
 * Effect's `bodyText` defaults to `text/plain` and overwrites any earlier
 * content-type header, so the JSON content type must be passed here.
 */
export function setEmptyJsonBody(
  request: HttpClientRequest.HttpClientRequest,
): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.bodyText(
    request,
    EMPTY_JSON_BODY,
    JSON_CONTENT_TYPE,
  )
}

export function setJsonBody(
  request: HttpClientRequest.HttpClientRequest,
  body: unknown,
): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.bodyText(
    request,
    JSON.stringify(body),
    JSON_CONTENT_TYPE,
  )
}
