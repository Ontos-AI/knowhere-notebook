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

async function readJson(request: Request): Promise<ReadJsonResult> {
  try {
    return {
      ok: true,
      value: await request.json(),
    }
  } catch {
    return { ok: false }
  }
}

async function readJsonOrNull(request: Request): Promise<unknown> {
  const body = await readJson(request)
  if (!body.ok) return null

  return body.value
}

export const routeResult = {
  ok,
  error,
  badRequest,
  readJson,
  readJsonOrNull,
} as const
