import { BookOpen } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ApiKeySettings } from "@/components/api-key-settings";

export type TopNavProps = {
  userInitials?: string;
  userName?: string;
  userTierLabel?: string;
  workspaceLabel?: string;
};

/**
 * Top navigation bar. Identity affordance on the right is a static placeholder
 * for the MVP shell — will be wired to the Dashboard session lookup in N-001.
 */
export function TopNav({
  userInitials,
  userName,
  userTierLabel,
  workspaceLabel = "Personal Workspace",
}: TopNavProps = {}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <div className="flex items-center gap-4">
        <div className="flex size-8 items-center justify-center rounded bg-primary">
          <BookOpen className="size-5 text-primary-foreground" />
        </div>
        <h1 className="text-lg font-bold tracking-tight text-foreground underline decoration-primary decoration-2 underline-offset-4">
          Knowhere Notebook
        </h1>
        <Separator orientation="vertical" className="mx-1 h-4" />
        <span className="text-sm font-medium text-muted-foreground">
          {workspaceLabel}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <ApiKeySettings />
        {userInitials && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              {userName && (
                <p className="text-xs font-semibold text-foreground">
                  {userName}
                </p>
              )}
              {userTierLabel && (
                <p className="text-[10px] text-muted-foreground">
                  {userTierLabel}
                </p>
              )}
            </div>
            <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
              {userInitials}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
