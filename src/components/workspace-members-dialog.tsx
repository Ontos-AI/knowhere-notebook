"use client";

import {
  type ReactElement,
  useState,
} from "react";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { workspaceClient } from "@/domains/workspace/client";
import type { WorkspaceMemberView } from "@/domains/workspace/client";

export type WorkspaceMembersDialogProps = {
  readonly workspaceId?: string;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

export function WorkspaceMembersDialog({
  workspaceId,
  isOpen,
  onOpenChange,
}: WorkspaceMembersDialogProps): ReactElement {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const { data: members, isLoading, mutate } = useSWR(
    workspaceId && isOpen
      ? ["workspace-members", workspaceId]
      : null,
    async ([, id]: readonly [string, string]) =>
      workspaceClient.fetchWorkspaceMembers(id),
    { revalidateOnFocus: false },
  );

  const handleOpenChange = (open: boolean): void => {
    onOpenChange(open)
    if (!open) {
      setEmail("")
      setError(null)
    }
  }

  async function handleAdd(): Promise<void> {
    const trimmed = email.trim()
    if (!trimmed || !workspaceId) return
    setIsAdding(true)
    setError(null)
    try {
      await workspaceClient.addWorkspaceMember(workspaceId, trimmed)
      setEmail("")
      await mutate()
    } catch (addError) {
      setError(
        addError instanceof Error
          ? addError.message
          : "Could not add the member.",
      )
    } finally {
      setIsAdding(false)
    }
  }

  async function handleRemove(member: WorkspaceMemberView): Promise<void> {
    if (!workspaceId) return
    setError(null)
    try {
      await workspaceClient.removeWorkspaceMember(workspaceId, member.userId)
      await mutate()
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not remove the member.",
      )
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Workspace members</DialogTitle>
          <DialogDescription>
            Invite Notebook users to share this workspace&apos;s sources and
            chats. Users must already have a Notebook account.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="member-email">Member email</Label>
            <div className="flex gap-2">
              <Input
                id="member-email"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void handleAdd()
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={isAdding || email.trim().length === 0}
                onClick={() => void handleAdd()}
              >
                {isAdding ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <UserPlus className="size-3.5" />
                )}
                Add
              </Button>
            </div>
            {error ? (
              <p className="text-xs font-semibold text-destructive">{error}</p>
            ) : null}
          </div>

          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                Loading members…
              </div>
            ) : (members ?? []).length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                No members yet. Invite a teammate by email.
              </p>
            ) : (
              (members ?? []).map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between gap-2 border-b border-border p-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">
                      {member.name ?? member.email ?? member.userId}
                    </p>
                    {member.email ? (
                      <p className="truncate text-[10px] text-muted-foreground">
                        {member.email}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => void handleRemove(member)}
                  >
                    <UserMinus className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
