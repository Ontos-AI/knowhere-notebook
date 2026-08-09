"use client";

import {
  Files,
  MessageCircle,
} from "lucide-react";
import type { PanelId } from "@/components/workspace-shell";

export type MobileTabBarProps = {
  activePanel: PanelId;
  onPanelChange: (panel: PanelId) => void;
  sourceCount: number;
  chunkCount: number;
  hasMessages: boolean;
};

export function MobileTabBar({
  activePanel,
  onPanelChange,
  sourceCount,
  hasMessages,
}: MobileTabBarProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex h-14 shrink-0 items-center justify-around border-t border-border/70 bg-background/95 backdrop-blur-sm min-[1116px]:hidden"
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
