import { Effect } from "effect"

export type RouteResult<TBody = unknown> = {
  readonly status: number
  readonly body: TBody
}

export type ReadJsonResult =
  | {
      readonly ok: true
      readonly value: unknown
    }
  | {
      readonly ok: false
    }

type MessageBody = {
  readonly message: string
}

function ok<TBody>(body: TBody, status = 200): RouteResult<TBody> {
  return { status, body }
}

function error(status: number, message: string): RouteResult<MessageBody> {
  return {
    status,
    body: { message },
  }
}

function badRequest(message: string): RouteResult<MessageBody> {
  return error(400, message)
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const readJsonEffect = (
  request: Request,
): Effect.Effect<ReadJsonResult, never> =>
  Effect.tryPromise(() => request.json()).pipe(
    Effect.map(
      (value): ReadJsonResult => ({ ok: true, value }),
    ),
    Effect.catchAllCause(
      (): Effect.Effect<ReadJsonResult, never> => Effect.succeed({ ok: false }),
    ),
  )

const readJsonOrNullEffect = (
  request: Request,
): Effect.Effect<unknown, never> =>
  readJsonEffect(request).pipe(
    Effect.map((body) => (body.ok ? body.value : null)),
  )

// ---------------------------------------------------------------------------
// Async wrappers (backward-compatible)
// ---------------------------------------------------------------------------

async function readJson(request: Request): Promise<ReadJsonResult> {
  return Effect.runPromise(readJsonEffect(request))
}

async function readJsonOrNull(request: Request): Promise<unknown> {
  return Effect.runPromise(readJsonOrNullEffect(request))
}

export const routeResult = {
  ok,
  error,
  badRequest,
  readJson,
  readJsonOrNull,
} as const
