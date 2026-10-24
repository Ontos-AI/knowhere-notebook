import { demoView } from "@/domains/demo/view"
import type { SourceView } from "@/domains/sources/types"
import type { Source } from "@/infrastructure/db/schema"
import type { DemoCatalog } from "@/integrations/knowhere-demo"

type WorkspaceDemoSourceResolution = {
  readonly workspaceSources: readonly Source[]
  readonly demoSources: readonly SourceView[]
}

export function resolveWorkspaceDemoSources(
  sources: readonly Source[],
  catalog: DemoCatalog,
  hiddenDemoSourceIds: ReadonlySet<string> = new Set<string>(),
  selectedDemoSourceIds: ReadonlySet<string> = new Set<string>(),
): WorkspaceDemoSourceResolution {
  return {
    workspaceSources: sources.filter((source) => source.demoKey === null),
    demoSources: catalog.sources
      .filter((source) => !hiddenDemoSourceIds.has(source.demoSourceId))
      .map((source) => selectedDemoSourceIds.has(source.demoSourceId)
        ? demoView.toSelectedSourceView(source)
        : demoView.toSourceView(source)),
  }
}
