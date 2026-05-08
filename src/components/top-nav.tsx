import { BookOpen } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export type TopNavProps = {
  userInitials?: string;
  userName?: string;
  userTierLabel?: string;
  workspaceLabel?: string;
};

/**
 * Top navigation bar. On mobile, the workspace label hides and the
 * user block collapses to just the avatar so the header stays
 * glanceable. The bottom tab bar takes over primary navigation.
 */
export function TopNav({
  userInitials,
  userName,
  userTierLabel,
  workspaceLabel = "Personal Workspace",
}: TopNavProps = {}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-3 lg:gap-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded bg-primary">
          <BookOpen className="size-5 text-primary-foreground" />
        </div>
        <h1 className="truncate text-lg font-bold tracking-tight text-foreground underline decoration-primary decoration-2 underline-offset-4">
          Knowhere Notebook
        </h1>
        <Separator
          orientation="vertical"
          className="mx-1 hidden h-4 lg:block"
        />
        <span className="hidden text-sm font-medium text-muted-foreground lg:block">
          {workspaceLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 lg:gap-3">
        {userInitials && (
          <>
            <div className="hidden text-right lg:block">
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
          </>
        )}
      </div>
    </header>
  );
}
