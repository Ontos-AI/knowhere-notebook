# ADR 0007: Chat Provider Abstraction (Vercel AI Gateway Or OpenAI-Compatible)

## Status

Accepted

## Context

Notebook chat — answer generation (`src/domains/chat/prompt.ts`) and diagram
generation (`src/domains/chat/diagram.ts`) — routed exclusively through the
Vercel AI Gateway. The model was passed to the AI SDK as a plain string id and
`AI_GATEWAY_API_KEY` was hard-required by a guard at every call site.

Self-hosted and local-LLM deployments need to point chat at an arbitrary
OpenAI-compatible endpoint (DeepSeek, local Xinference/vLLM, etc.) without the
Gateway. There was no way to do that without editing call-site code.

## Decision

Resolve the chat model once in `src/lib/ai.ts`. Two mutually exclusive backends,
selected by environment:

- `AI_GATEWAY_API_KEY` set (default): pass the model id as a plain string; the
  AI SDK resolves it through the Vercel AI Gateway and reads the key
  automatically. `CHAT_MODEL` overrides the default id.
- `CHAT_BASE_URL` set: build a `LanguageModelV3` with
  `@ai-sdk/openai-compatible` from `CHAT_BASE_URL` + `CHAT_API_KEY`.
  `CHAT_MODEL` is **mandatory** in this mode.

Call sites use `getChatModel()` (the model to pass to `generateObject` /
`ToolLoopAgent`), `getChatModelLabel()` (stable log label), and
`isChatConfigured()` (the guard) instead of referencing `AI_GATEWAY_API_KEY`
directly.

The `@ai-sdk/openai-compatible` package is pinned to the `2.x` line. The `3.x`
line targets `@ai-sdk/provider@4` (spec V4), which is incompatible with this
repo's `ai@6` (spec V3). Re-pin both together when upgrading `ai` to a V4-based
release.

## Consequences

Chat can target any OpenAI-compatible endpoint by setting three env vars, with
no code change. The Gateway path is unchanged.

Adding a third provider means extending `getChatModel()` and
`isChatConfigured()`. Do not reintroduce per-call-site `AI_GATEWAY_API_KEY`
guards.

`CHAT_MODEL` is read at call time in the OpenAI-compatible path and at module
load in the Gateway path; tests that mutate `CHAT_MODEL` after import should
assert behavior rather than the resolved module constant.
