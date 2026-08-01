"use client";

import { useEffect, useState } from "react";

import type { ChatPromptTemplate } from "@/domains/chat/prompt-templates";

const promptTemplatesURL = `/data/chat-prompt-templates.json?v=${encodeURIComponent(
  Date.now().toString(36),
)}`;

type PromptTemplatesState = {
  readonly isLoading: boolean;
  readonly templates: readonly ChatPromptTemplate[];
};

export function usePromptTemplates(): PromptTemplatesState {
  const [state, setState] = useState<PromptTemplatesState>({
    isLoading: true,
    templates: [],
  });

  useEffect(() => {
    let cancelled = false;

    fetch(promptTemplatesURL)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: unknown) => {
        if (cancelled) return;
        setState({
          isLoading: false,
          templates: Array.isArray(data)
            ? data.filter(isChatPromptTemplate)
            : [],
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ isLoading: false, templates: [] });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function isChatPromptTemplate(value: unknown): value is ChatPromptTemplate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.prompt === "string"
  );
}
