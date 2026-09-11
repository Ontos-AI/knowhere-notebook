import { Effect } from "effect"

import { folderWorkflowRuntime } from "@/domains/folders/workflow-runtime"
import { routeResult } from "@/lib/route-result"
import { toSourceView } from "./view"
import { sourceWorkflowRuntime } from "./workflow-runtime"
import type {
  AssignSourceFolderBody,
  AssignSourceFolderInput,
  JsonRouteResult,
  SourceRouteServiceDependencies,
} from "./route-types"

type RouteAssignFolderDependencies = Pick<
  SourceRouteServiceDependencies,
  "ensureWorkspace" | "requireUser" | "sourceService"
>

type RouteAssignFolder = {
  readonly assignSourceFolder: (
    input: AssignSourceFolderInput,
  ) => Promise<JsonRouteResult<AssignSourceFolderBody>>
}

function createRouteAssignFolder(
  deps: RouteAssignFolderDependencies,
): RouteAssignFolder {
  return {
    assignSourceFolder: (input: AssignSourceFolderInput) =>
      Effect.runPromise(assignSourceFolderEffect(input, deps)),
  }
}

const assignSourceFolderEffect = (
  input: AssignSourceFolderInput,
  deps: RouteAssignFolderDependencies,
) =>
  Effect.gen(function* () {
    const user = yield* Effect.tryPromise(() => deps.requireUser())
    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )
    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.findInWorkspace(workspace.id, input.sourceId),
    )
    if (!source) {
      return routeResult.error(404, "Source not found.")
    }
    if (source.demoKey) {
      return routeResult.error(
        409,
        "Demo sources cannot be moved into folders.",
      )
    }

    if (input.folderId !== null) {
      const folder = yield* Effect.tryPromise(() =>
        folderWorkflowRuntime.findInWorkspace(workspace.id, input.folderId!),
      )
      if (!folder) {
        return routeResult.error(404, "Folder not found.")
      }
    }

    const updated = yield* Effect.tryPromise(() =>
      sourceWorkflowRuntime.assignFolder(
        workspace.id,
        input.sourceId,
        input.folderId,
      ),
    )
    if (!updated) {
      return routeResult.error(404, "Source not found.")
    }

    return routeResult.ok({ source: toSourceView(updated) })
  })

export { createRouteAssignFolder }
