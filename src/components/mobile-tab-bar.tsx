"use client";

import {
  Files,
  Layers,
  MessageCircle,
} from "lucide-react";
import type { PanelId } from "@/components/workspace-shell";

export type MobileTabBarProps = {
  activePanel: PanelId;
  onPanelChange: (panel: PanelId) => void;
  sourceCount: number;
  chunkCount: number;
  /**
   * Lights a blue dot on the Chat tab.
   *
   * Named `hasMessages` rather than `hasUnread` deliberately: the MVP has
   * no per-user read-state tracking and no real-time delivery, so a
   * "new since you last looked" indicator is not feasible without
   * persistent last-read timestamps. The dot keeps Chat discoverable
   * after the first exchange — once messages exist, the tab signals that
   * Chat is active, not that it has unseen content.
   */
  hasMessages: boolean;
};

/**
 * Fixed bottom tab bar for phone screens. Only three slots:
 * Sources, Content Sections, and Chat.
 *
 * The `lg:hidden` keeps it invisible on desktop where the three-panel
 * side-by-side layout takes over.
 */
export function MobileTabBar({
  activePanel,
  onPanelChange,
  sourceCount,
  chunkCount,
  hasMessages,
}: MobileTabBarProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex h-14 shrink-0 items-center justify-around border-t border-border bg-background lg:hidden"
      aria-label="Panel navigation"
      role="tablist"
    >
      <TabButton
        id="sources"
        icon={Files}
        label="Sources"
        badge={sourceCount > 0 ? String(sourceCount) : undefined}
        isActive={activePanel === "sources"}
        onClick={() => onPanelChange("sources")}
      />
      <TabButton
        id="content"
        icon={Layers}
        label="Content"
        badge={chunkCount > 0 ? String(chunkCount) : undefined}
        isActive={activePanel === "content"}
        onClick={() => onPanelChange("content")}
      />
      <TabButton
        id="chat"
        icon={MessageCircle}
        label="Chat"
        dot={hasMessages}
        isActive={activePanel === "chat"}
        onClick={() => onPanelChange("chat")}
      />
    </nav>
  );
}

function TabButton({
  id,
  icon: Icon,
  label,
  badge,
  dot,
  isActive,
  onClick,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string;
  dot?: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`panel-${id}`}
      id={`tab-${id}`}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[10px] font-medium transition-colors ${
        isActive
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="relative">
        <Icon className="size-5" />
        {dot && (
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-background" />
        )}
      </span>
      {label}
      {badge && (
        <span className="absolute right-1 top-0 rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}
