import { NotebookLogoMark } from "@/components/notebook-logo-mark";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogOut } from "lucide-react";
import type { ReactElement } from "react";
import { logoutAction } from "@/app/auth/logout/actions";

export type TopNavProps = {
  userInitials?: string;
  userName?: string;
  userTierLabel?: string;
  workspaceLabel?: string;
};

export function TopNav({
  userInitials,
  userName,
  userTierLabel,
  workspaceLabel = "Personal Workspace",
}: TopNavProps): ReactElement {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/70 bg-background/95 px-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.35)] backdrop-blur-sm lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <NotebookLogoMark width={22} />
        <h1 className="truncate text-[18px] font-bold leading-7 text-foreground">
          Knowhere Notebook
        </h1>
        <Separator
          orientation="vertical"
          className="mx-1 hidden h-4 lg:block"
        />
        <span className="hidden text-sm font-medium text-foreground lg:block">
          {workspaceLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 lg:gap-3">
        <ThemeToggle />
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
            <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">
              {userInitials}
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
