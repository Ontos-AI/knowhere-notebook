const databaseConnectionMessage = "connect ECONNREFUSED 127.0.0.1:5434"
const fiberCauseSymbol = Symbol.for("effect/Runtime/FiberFailure/Cause")
const workspaceOperationMessage =
  "Workspace initial state getOptionalAuthenticated failed"

export function makeWorkspaceInitialStateFailureFixture(): {
  readonly boundaryMessage: string
  readonly error: Error
  readonly rootCauseMessage: string
} {
  const databaseConnectionError = new Error(databaseConnectionMessage)
  const queryError = new Error(
    'Failed query: select "id" from "workspaces" where "user_id" = $1',
  )
  Object.defineProperty(queryError, fiberCauseSymbol, {
    value: {
      _tag: "Die",
      defect: databaseConnectionError,
    },
  })
  const unknownException = new Error(
    "An unknown error occurred in Effect.tryPromise",
    { cause: queryError },
  )
  const operationError = new Error(workspaceOperationMessage, {
    cause: unknownException,
  })
  operationError.name = "EffectOperationError"
  Object.defineProperty(operationError, "_tag", {
    value: "EffectOperationError",
  })
  const outerFiberFailure = new Error(workspaceOperationMessage)
  Object.defineProperty(outerFiberFailure, fiberCauseSymbol, {
    value: {
      _tag: "Fail",
      error: operationError,
    },
  })

  return {
    boundaryMessage: `Workspace initial state failed: ${databaseConnectionMessage}`,
    error: outerFiberFailure,
    rootCauseMessage: databaseConnectionMessage,
  }
}
