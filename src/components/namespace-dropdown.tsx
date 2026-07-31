"use client"

import { type ReactElement, useState } from "react"
import { ChevronDown, Globe } from "lucide-react"
import useSWR from "swr"
import useSWRMutation from "swr/mutation"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { workspaceClient } from "@/domains/workspace/client"
import type { SourceView } from "@/domains/sources/types"

export type NamespaceDropdownProps = {
  readonly onSourcesLocalized?: (sources: readonly SourceView[]) => void
}

export function NamespaceDropdown({
  onSourcesLocalized,
}: NamespaceDropdownProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const { data: namespaces, isLoading } = useSWR(
    workspaceClient.keys.namespaces,
    workspaceClient.fetchNamespaces,
    { revalidateOnFocus: false },
  )
  const { trigger: localize, isMutating } = useSWRMutation(
    "localize-namespace",
    (_key: string, { arg }: { readonly arg: string }) =>
      workspaceClient.localizeNamespace(arg),
  )

  async function handleSelect(namespace: string): Promise<void> {
    try {
      const sources = await localize(namespace)
      onSourcesLocalized?.(sources)
    } catch {
      // Error is swallowed; the UI stays on the current source list.
    }
    setIsOpen(false)
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/80 bg-background px-2 text-[11px] font-semibold text-foreground shadow-xs hover:bg-muted"
          disabled={isMutating}
        >
          {isMutating ? (
            <Spinner className="size-3.5" />
          ) : (
            <Globe className="size-3.5" />
          )}
          Add namespace
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Namespaces
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading ? (
          <DropdownMenuItem disabled>
            <Spinner className="mr-2 size-3.5" />
            Loading…
          </DropdownMenuItem>
        ) : namespaces && namespaces.length > 0 ? (
          namespaces.map((ns) => (
            <DropdownMenuItem
              key={ns.namespace}
              onClick={() => void handleSelect(ns.namespace)}
              className="flex items-center justify-between gap-4 text-xs"
            >
              <span className="font-medium">{ns.namespace}</span>
              <span className="text-muted-foreground">
                {ns.documentCount} {ns.documentCount === 1 ? "doc" : "docs"}
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            No namespaces available
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
