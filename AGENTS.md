<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing or modifying any
Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first. In the final response,
name the guide topics you consulted when Effect code changed.

For browser and server HTTP calls in app code, prefer the established
Effect/@effect/platform pattern (`HttpClientRequest`, `HttpClient`,
`FetchHttpClient`) or an existing local wrapper. Do not introduce direct
component-level `fetch` calls unless there is a specific API limitation, and
document that limitation before coding.

## Local Effect Source

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

<!-- effect-solutions:end -->

## UI & Design

The notebook should reuse the existing design units from the dashboard(~/github.com/ontosAI/knowhere-dashboard), like theme, styles, buttons, form elements, etc. For any new design units, please refer to the dashboard's design system and maintain consistency in terms of spacing, typography, and color usage.
