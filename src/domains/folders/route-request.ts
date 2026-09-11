import { Schema } from "effect"

import { routeResult, type RouteResult } from "@/lib/route-result"

type FolderRequestInput = {
  readonly request: Request
}

type CreateFolderReadResult =
  | {
      readonly ok: true
      readonly parentId: string | null
      readonly name: string
    }
  | {
      readonly ok: false
      readonly result: RouteResult<{ readonly message: string }>
    }

type UpdateFolderReadResult =
  | {
      readonly ok: true
      readonly name?: string
      readonly parentId?: string | null
    }
  | {
      readonly ok: false
      readonly result: RouteResult<{ readonly message: string }>
    }

const CreateFolderRequest = Schema.Struct({
  name: Schema.String,
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
})

const UpdateFolderRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
})

async function readCreateFolder({
  request,
}: FolderRequestInput): Promise<CreateFolderReadResult> {
  const body = await routeResult.readJson(request)
  if (!body.ok) {
    return {
      ok: false,
      result: routeResult.badRequest("Invalid request body."),
    }
  }

  const decoded = Schema.decodeUnknownEither(CreateFolderRequest)(body.value)
  if (decoded._tag === "Left") {
    return {
      ok: false,
      result: routeResult.badRequest("Request body must include a folder name."),
    }
  }

  return {
    ok: true,
    name: decoded.right.name,
    parentId: decoded.right.parentId ?? null,
  }
}

async function readUpdateFolder({
  request,
}: FolderRequestInput): Promise<UpdateFolderReadResult> {
  const body = await routeResult.readJson(request)
  if (!body.ok) {
    return {
      ok: false,
      result: routeResult.badRequest("Invalid request body."),
    }
  }

  const decoded = Schema.decodeUnknownEither(UpdateFolderRequest)(body.value)
  if (decoded._tag === "Left") {
    return {
      ok: false,
      result: routeResult.badRequest(
        "Request body must include a folder name or parentId.",
      ),
    }
  }

  if (
    decoded.right.name === undefined &&
    decoded.right.parentId === undefined
  ) {
    return {
      ok: false,
      result: routeResult.badRequest(
        "Request body must include a folder name or parentId.",
      ),
    }
  }

  return {
    ok: true,
    ...(decoded.right.name !== undefined ? { name: decoded.right.name } : {}),
    ...(decoded.right.parentId !== undefined
      ? { parentId: decoded.right.parentId }
      : {}),
  }
}

export const folderRouteRequest = {
  readCreateFolder,
  readUpdateFolder,
}
