import { NotebookLogoMark } from "@/components/notebook-logo-mark";
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
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[#d4d4d8] bg-[#fafafa] px-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.35)] backdrop-blur-sm lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <NotebookLogoMark width={22} />
        <h1 className="truncate text-[18px] font-bold leading-7 text-[#09090b]">
          Knowhere Notebook
        </h1>
        <Separator
          orientation="vertical"
          className="mx-1 hidden h-4 lg:block"
        />
        <span className="hidden text-sm font-medium text-[#09090b] lg:block">
          {workspaceLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 lg:gap-3">
        {userInitials && (
          <>
            <div className="hidden text-right lg:block">
              {userName && (
                <p className="text-xs font-semibold text-[#09090b]">
                  {userName}
                </p>
              )}
              {userTierLabel && (
                <p className="text-[10px] text-[#71717b]">
                  {userTierLabel}
                </p>
              )}
            </div>
            <div className="flex size-8 items-center justify-center rounded-full bg-[#f4f4f5] text-xs font-bold text-[#09090b]">
              {userInitials}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
