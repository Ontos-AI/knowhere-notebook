"use client";

import {
  type ReactElement,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, KeyRound, Loader2, Users } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceApiKeysDialog } from "@/components/workspace-api-keys-dialog";
import { WorkspaceMembersDialog } from "@/components/workspace-members-dialog";
import { workspaceClient } from "@/domains/workspace/client";
import type {
  KnowhereKeyLabelView,
  WorkspaceView,
} from "@/domains/workspace/client";

export type WorkspaceSwitcherProps = {
  readonly activeWorkspace?: WorkspaceView;
  readonly knowhereKeyLabels?: readonly KnowhereKeyLabelView[];
  readonly userName?: string;
  readonly workspaces?: readonly WorkspaceView[];
};

export function WorkspaceSwitcher({
  activeWorkspace,
  knowhereKeyLabels = [],
  userName,
  workspaces = [],
}: WorkspaceSwitcherProps): ReactElement {
  const router = useRouter();
  const [isApiKeysOpen, setIsApiKeysOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [creatingKeyLabel, setCreatingKeyLabel] = useState<string | null>(null);
  const [creatingNamespace, setCreatingNamespace] = useState<string | null>(
    null,
  );
  const { data: keyNamespacesByKeyId, isLoading: isLoadingNamespaces } = useSWR(
    knowhereKeyLabels.length > 0
      ? ["all-key-namespaces", knowhereKeyLabels.map((k) => k.id).join(",")]
      : null,
    async ([, ids]: readonly [string, string]) => {
      const results = await Promise.all(
        ids
          .split(",")
          .map(async (keyId) => ({
            keyId,
            namespaces: await workspaceClient.fetchApiKeyNamespaces(keyId),
          })),
      )
      return Object.fromEntries(
        results.map((entry) => [entry.keyId, entry.namespaces]),
      )
    },
    { revalidateOnFocus: false },
  );

  const workspacesByNamespace = useMemo(() => {
    const byNamespace = new Map<string, WorkspaceView>()
    for (const workspace of workspaces) {
      byNamespace.set(workspace.namespace, workspace)
    }
    return byNamespace
  }, [workspaces])

  const triggerText = activeWorkspace
    ? `${activeWorkspace.activeKeyLabel ?? "default"} / ${activeWorkspace.namespace}`
    : knowhereKeyLabels.length === 0
      ? "Add API key"
      : "Pick a workspace"

  async function handlePickNamespace(
    keyLabel: string,
    namespace: string,
  ): Promise<void> {
    if (creatingKeyLabel !== null) return
    setCreatingKeyLabel(keyLabel)
    setCreatingNamespace(namespace)
    try {
      const key = knowhereKeyLabels.find((k) => k.label === keyLabel)
      if (!key) return
      await workspaceClient.createWorkspace(key.id, namespace)
      router.refresh()
    } catch {
      // Error swallowed; dropdown stays open.
    } finally {
      setCreatingKeyLabel(null)
      setCreatingNamespace(null)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="inline-flex h-8 w-full shrink-0 items-center gap-1.5 rounded-md border border-border/80 bg-background px-2 text-[11px] font-semibold text-foreground shadow-xs hover:bg-muted"
          >
            <KeyRound className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{triggerText}</span>
            <ChevronDown className="size-3 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 w-72 overflow-y-auto"
        >
          {knowhereKeyLabels.length === 0 ? (
            <DropdownMenuItem
              disabled
              className="text-xs text-muted-foreground"
            >
              Add an API key to browse namespaces.
            </DropdownMenuItem>
          ) : isLoadingNamespaces ? (
            <DropdownMenuItem disabled>
              <Spinner className="mr-2 size-3.5" />
              Loading namespaces…
            </DropdownMenuItem>
          ) : (
            knowhereKeyLabels.map((key) => {
              const namespaces = keyNamespacesByKeyId?.[key.id] ?? []
              return (
                <div key={key.id}>
                  <DropdownMenuLabel className="px-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {key.label}
                    <span className="ml-1 font-mono text-[9px] font-normal opacity-70">
                      {key.mask}
                    </span>
                  </DropdownMenuLabel>
                  {namespaces.map((ns) => {
                    const existing = workspacesByNamespace.get(ns.namespace)
                    const isActive =
                      existing?.id === activeWorkspace?.id
                    const isCreating =
                      creatingKeyLabel === key.label &&
                      creatingNamespace === ns.namespace
                    return (
                      <DropdownMenuItem
                        key={`${key.id}:${ns.namespace}`}
                        disabled={isCreating || creatingKeyLabel !== null}
                        onClick={() =>
                          void handlePickNamespace(key.label, ns.namespace)
                        }
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 truncate font-medium">
                          {ns.namespace}
                        </span>
                        {isCreating ? (
                          <Loader2 className="size-3.5 shrink-0 animate-spin" />
                        ) : isActive ? (
                          <Check className="size-3.5 shrink-0 text-primary" />
                        ) : existing ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            exists
                          </span>
                        ) : (
                          <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </DropdownMenuItem>
                    )
                  })}
                  {namespaces.length === 0 ? (
                    <DropdownMenuItem
                      disabled
                      className="text-[11px] text-muted-foreground"
                    >
                      No namespaces for this key.
                    </DropdownMenuItem>
                  ) : null}
                </div>
              )
            })
          )}
          <DropdownMenuSeparator />
          {activeWorkspace ? (
            <>
              <DropdownMenuItem
                onClick={() => setIsMembersOpen(true)}
                className="flex items-center gap-2 text-xs font-semibold"
              >
                <Users className="size-3.5" />
                Members…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            onClick={() => setIsApiKeysOpen(true)}
            className="flex items-center gap-2 text-xs font-semibold"
          >
            <KeyRound className="size-3.5" />
            API keys…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkspaceApiKeysDialog
        isOpen={isApiKeysOpen}
        onOpenChange={setIsApiKeysOpen}
        onKeysChanged={() => {
          // Re-fetch SSR state so the dropdown sees the new key and its
          // namespaces (knowhereKeyLabels changes → namespaces SWR refires).
          router.refresh();
        }}
        userName={userName}
      />

      <WorkspaceMembersDialog
        workspaceId={activeWorkspace?.id}
        isOpen={isMembersOpen}
        onOpenChange={setIsMembersOpen}
      />
    </>
  );
}

function PlusIcon({
  className,
}: {
  readonly className?: string;
}): ReactElement {
  return (
    <span className={className} aria-hidden="true">
      +
    </span>
  );
}
