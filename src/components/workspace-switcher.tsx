"use client";

import {
  type ReactElement,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Boxes, Check, ChevronDown, Plus } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { workspaceClient } from "@/domains/workspace/client";
import type { WorkspaceView } from "@/domains/workspace/client";

export type WorkspaceSwitcherProps = {
  readonly activeWorkspace?: WorkspaceView;
  readonly knowhereKeyLabels?: readonly {
    readonly label: string;
    readonly mask: string;
  }[];
  readonly workspaces?: readonly WorkspaceView[];
};

type NewWorkspaceDialogState = {
  readonly isOpen: boolean;
  readonly keyLabel: string | null;
  readonly namespace: string | null;
};

export function WorkspaceSwitcher({
  activeWorkspace,
  knowhereKeyLabels = [],
  workspaces = [],
}: WorkspaceSwitcherProps): ReactElement {
  const router = useRouter();
  const [dialog, setDialog] = useState<NewWorkspaceDialogState>({
    isOpen: false,
    keyLabel: null,
    namespace: null,
  });
  const [isActivatingId, setIsActivatingId] = useState<string | null>(null);
  const { data: keyNamespaces, isLoading: isLoadingKeyNamespaces } = useSWR(
    dialog.keyLabel
      ? ["knowhere-key-namespaces", dialog.keyLabel]
      : null,
    ([, label]: readonly [string, string]) =>
      workspaceClient.fetchKnowhereKeyNamespaces(label),
    { revalidateOnFocus: false },
  );

  const workspacesByKeyLabel = useMemo(() => {
    const grouped = new Map<string, WorkspaceView[]>();
    for (const workspace of workspaces) {
      const keyLabel = workspace.keyLabel ?? "default";
      const group = grouped.get(keyLabel) ?? [];
      group.push(workspace);
      grouped.set(keyLabel, group);
    }
    return grouped;
  }, [workspaces]);

  async function handleActivate(workspaceId: string): Promise<void> {
    if (isActivatingId !== null) return;
    setIsActivatingId(workspaceId);
    try {
      await workspaceClient.activateWorkspace(workspaceId);
      router.refresh();
    } catch {
      setIsActivatingId(null);
    }
  }

  async function handleCreate(): Promise<void> {
    if (!dialog.keyLabel || !dialog.namespace) return;
    try {
      await workspaceClient.createWorkspace(dialog.keyLabel, dialog.namespace);
      router.refresh();
    } catch {
      setDialog((current) => ({ ...current, isOpen: false }));
    }
  }

  const activeLabel = activeWorkspace?.keyLabel ?? "default";
  const labelWithoutWorkspace = knowhereKeyLabels.filter(
    (key) => !workspacesByKeyLabel.has(key.label),
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="inline-flex h-8 w-full shrink-0 items-center gap-1.5 rounded-md border border-border/80 bg-background px-2 text-[11px] font-semibold text-foreground shadow-xs hover:bg-muted"
          >
            <Boxes className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {activeWorkspace
                ? `${activeLabel} / ${activeWorkspace.namespace}`
                : "Select workspace"}
            </span>
            <ChevronDown className="size-3 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
          <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {workspaces.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No workspaces yet
            </DropdownMenuItem>
          ) : (
            Array.from(workspacesByKeyLabel.entries()).map(
              ([keyLabel, grouped]) => (
                <div key={keyLabel}>
                  {keyLabel !== "default" && (
                    <DropdownMenuLabel className="px-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {keyLabel}
                    </DropdownMenuLabel>
                  )}
                  {grouped.map((workspace) => (
                    <DropdownMenuItem
                      key={workspace.id}
                      disabled={isActivatingId !== null}
                      onClick={() => void handleActivate(workspace.id)}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="min-w-0 truncate font-medium">
                        {workspace.namespace}
                      </span>
                      {workspace.id === activeWorkspace?.id ? (
                        <Check className="size-3.5 shrink-0 text-primary" />
                      ) : isActivatingId === workspace.id ? (
                        <Spinner className="size-3.5 shrink-0" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </div>
              ),
            )
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              setDialog({ isOpen: true, keyLabel: null, namespace: null })
            }
            className="flex items-center gap-2 text-xs font-semibold"
          >
            <Plus className="size-3.5" />
            New workspace…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialog({ isOpen: false, keyLabel: null, namespace: null });
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              Pick a domain (API key) and a namespace under it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Domain
              </span>
              <div className="flex flex-wrap gap-1.5">
                {knowhereKeyLabels.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    No API keys configured.
                  </span>
                ) : (
                  knowhereKeyLabels.map((key) => (
                    <Button
                      key={key.label}
                      type="button"
                      size="sm"
                      variant={dialog.keyLabel === key.label ? "default" : "outline"}
                      className="text-[11px]"
                      onClick={() =>
                        setDialog((current) => ({
                          ...current,
                          keyLabel: key.label,
                          namespace: null,
                        }))
                      }
                    >
                      {key.label}
                      <span className="ml-1 font-mono text-[10px] opacity-70">
                        {key.mask}
                      </span>
                    </Button>
                  ))
                )}
              </div>
            </div>
            {dialog.keyLabel && (
              <div className="grid gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Namespace
                </span>
                {isLoadingKeyNamespaces ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-3.5" />
                    Loading namespaces…
                  </div>
                ) : keyNamespaces && keyNamespaces.length > 0 ? (
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {keyNamespaces.map((ns) => (
                      <Button
                        key={ns.namespace}
                        type="button"
                        size="sm"
                        variant={
                          dialog.namespace === ns.namespace
                            ? "default"
                            : "outline"
                        }
                        className="text-[11px]"
                        onClick={() =>
                          setDialog((current) => ({
                            ...current,
                            namespace: ns.namespace,
                          }))
                        }
                      >
                        {ns.namespace}
                        <span className="ml-1 text-[10px] opacity-70">
                          {ns.documentCount}
                        </span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No namespaces available for this key.
                  </span>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDialog({ isOpen: false, keyLabel: null, namespace: null })
              }
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!dialog.keyLabel || !dialog.namespace}
              onClick={() => void handleCreate()}
            >
              Create workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {labelWithoutWorkspace.length > 0 && (
        <p className="mt-1 px-0.5 text-[10px] text-muted-foreground">
          {labelWithoutWorkspace.map((key) => key.label).join(", ")}: add a
          workspace to browse those documents
        </p>
      )}
    </>
  );
}
