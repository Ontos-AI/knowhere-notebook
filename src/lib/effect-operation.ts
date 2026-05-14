import { Effect, Schema } from "effect"

import { summarizeUnknownError } from "./format-log-value"

type OperationContext =
  | string
  | {
      readonly context: string
      readonly operation: string
    }
type NormalizedOperationContext = {
  readonly context: string
  readonly operation: string
}

class EffectOperationError extends Schema.TaggedError<EffectOperationError>()(
  "EffectOperationError",
  {
    context: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect,
  },
) {
  override get message(): string {
    return `${this.context} ${this.operation} failed`
  }
}

function tryPromise<Value>(
  operationContext: OperationContext,
  runOperation: () => Promise<Value>,
): Effect.Effect<Value, EffectOperationError> {
  return Effect.tryPromise({
    try: runOperation,
    catch: (error) =>
      new EffectOperationError({
        ...normalizeOperationContext(operationContext),
        cause: error,
      }),
  })
}

function addContext<Value, ErrorValue, Requirements>(
  operationContext: OperationContext,
  effect: Effect.Effect<Value, ErrorValue, Requirements>,
): Effect.Effect<Value, EffectOperationError, Requirements> {
  return effect.pipe(
    Effect.catchAllCause((cause) =>
      Effect.fail(
        new EffectOperationError({
          ...normalizeOperationContext(operationContext),
          cause,
        }),
      ),
    ),
  )
}

function createBoundaryError(message: string, cause: unknown): Error {
  return new Error(`${message}: ${summarizeUnknownError(cause)}`, {
    cause,
  })
}

function normalizeOperationContext(
  operationContext: OperationContext,
): NormalizedOperationContext {
  if (typeof operationContext === "string") {
    return {
      context: "Effect operation",
      operation: operationContext,
    }
  }

  return operationContext
}

export const effectOperation = {
  addContext,
  createBoundaryError,
  tryPromise,
} as const
