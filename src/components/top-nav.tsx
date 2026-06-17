import { NotebookLogoMark } from "@/components/notebook-logo-mark";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  trackNotebookDashboardLinkClicked,
  type AnalyticsContext,
} from "@/lib/posthog";
import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";

export type TopNavProps = {
  dashboardUrl?: string | null;
  analyticsContext?: AnalyticsContext;
  hasChats?: boolean;
  hasSources?: boolean;
  userInitials?: string;
  userName?: string;
  userTierLabel?: string;
  workspaceLabel?: string;
};

export function TopNav({
  dashboardUrl,
  analyticsContext,
  hasChats = false,
  hasSources = false,
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
        {dashboardUrl ? (
          <a
            href={dashboardUrl}
            aria-label="Open Dashboard"
            onClick={() => {
              void trackNotebookDashboardLinkClicked({
                context: analyticsContext,
                targetUrl: dashboardUrl,
                fromPage:
                  typeof window !== "undefined"
                    ? window.location.pathname
                    : "notebook",
                hasSources,
                hasChats,
              });
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8e51ff]/25"
          >
            <span className="hidden sm:inline">Dashboard</span>
            <ExternalLink className="hidden size-3.5 sm:block" strokeWidth={1.75} />
          </a>
        ) : null}
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
          </>
        )}
      </div>
    </header>
  );
}
