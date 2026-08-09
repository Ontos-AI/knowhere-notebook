"use client";

import { type ReactElement, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type CollapsibleSectionProps = {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly badge?: number;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
};

export function CollapsibleSection({
  title,
  icon,
  badge,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps): ReactElement {
  return (
    <div className="mt-3 border-t border-border/70 pt-2.5">
      <Collapsible defaultOpen={defaultOpen}>
        <CollapsibleTrigger className="group mb-2 flex w-full cursor-pointer items-center gap-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRight className="size-3 shrink-0 transition-transform duration-150 group-data-[panel-open]:rotate-90" />
          {icon}
          {title}
          {typeof badge === "number" && badge > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] font-semibold leading-none text-muted-foreground">
              {badge}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </div>
  );
}
