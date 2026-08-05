"use client";

import { type ReactElement, useState } from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { workspaceClient } from "@/domains/workspace/client";
import type { WorkspaceApiKeyView } from "@/domains/workspace/client";

export type WorkspaceApiKeysDialogProps = {
  readonly workspaceId: string | null;
  readonly onOpenChange: (open: boolean) => void;
};

export function WorkspaceApiKeysDialog({
  workspaceId,
  onOpenChange,
}: WorkspaceApiKeysDialogProps): ReactElement {
  const [isAdding, setIsAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: keys, isLoading, mutate } = useSWR(
    workspaceId ? ["workspace-api-keys", workspaceId] : null,
    ([, id]: readonly [string, string]) =>
      workspaceClient.fetchWorkspaceApiKeys(id),
    { revalidateOnFocus: false },
  );

  async function handleAdd(): Promise<void> {
    if (!workspaceId || !label.trim() || !apiKey.trim()) return;
    setError(null);
    try {
      await workspaceClient.createWorkspaceApiKey(
        workspaceId,
        label.trim(),
        apiKey.trim(),
      );
      setLabel("");
      setApiKey("");
      setIsAdding(false);
      await mutate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the key.");
    }
  }

  async function handleSetActive(key: WorkspaceApiKeyView): Promise<void> {
    if (!workspaceId) return;
    await workspaceClient.setActiveWorkspaceApiKey(
      workspaceId,
      key.id,
      !key.isActive,
    );
    await mutate();
  }

  async function handleDelete(key: WorkspaceApiKeyView): Promise<void> {
    if (!workspaceId) return;
    await workspaceClient.deleteWorkspaceApiKey(workspaceId, key.id);
    await mutate();
  }

  return (
    <Dialog
      open={workspaceId !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>API keys</DialogTitle>
          <DialogDescription>
            Knowhere credentials for this workspace. Keys are encrypted at
            rest and never shown again after saving.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              Loading keys…
            </div>
          ) : keys && keys.length > 0 ? (
            keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/35 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                    {key.label}
                    {key.isActive ? (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                        active
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Added {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={key.isActive}
                    onClick={() => void handleSetActive(key)}
                  >
                    {key.isActive ? "Active" : "Activate"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${key.label}`}
                    onClick={() => void handleDelete(key)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              No API keys yet. Add one to connect this workspace to Knowhere.
            </p>
          )}

          {isAdding ? (
            <div className="grid gap-3 rounded-md border border-border/70 bg-muted/20 p-3">
              <div className="grid gap-1.5">
                <Label htmlFor="key-label" className="text-[11px]">
                  Label
                </Label>
                <Input
                  id="key-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. domainA"
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="key-value" className="text-[11px]">
                  API key
                </Label>
                <Input
                  id="key-value"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk_…"
                  className="h-8 font-mono text-xs"
                />
              </div>
              {error ? (
                <p className="text-xs font-semibold text-destructive">{error}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {isAdding ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAdding(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!label.trim() || !apiKey.trim()}
                onClick={() => void handleAdd()}
              >
                <Loader2 className="size-3.5" />
                Save key
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="size-3.5" />
              Add key
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
