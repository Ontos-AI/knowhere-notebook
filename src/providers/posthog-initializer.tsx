"use client";

import { type ReactNode, useEffect } from "react";
import { initPostHogClient } from "@/lib/posthog";

export function PostHogInitializer({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  useEffect(() => {
    void initPostHogClient();
  }, []);

  return children;
}
