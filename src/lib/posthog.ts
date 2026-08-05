"use client";

import posthog, { type Properties } from "posthog-js";
let isInitialized = false;

const POSTHOG_CLOUD_HOST: string = "https://us.i.posthog.com";

export type AnalyticsContext = {
  readonly workspaceId?: string;
  readonly workspaceNamespace?: string;
  readonly userId?: string;
};

type AnalyticsEnvelope = {
  readonly context?: AnalyticsContext;
};

function getPostHogKey(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key && key.trim().length > 0 ? key : null;
}

function getPostHogHost(): string {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  return host && host.length > 0 ? host : POSTHOG_CLOUD_HOST;
}

export function isPostHogEnabled(): boolean {
  return getPostHogKey() !== null;
}

export function initPostHogClient(): void {
  const key = getPostHogKey();
  if (!key) return;
  if (typeof window === "undefined" || isInitialized) return;

  posthog.init(key, {
    api_host: getPostHogHost(),
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
  });
  isInitialized = true;
}

function ensurePostHogClient(): boolean {
  if (typeof window === "undefined" || !isPostHogEnabled()) return false;
  if (!isInitialized) initPostHogClient();
  return isInitialized;
}

export function trackEvent(
  eventName: string,
  properties?: Properties,
): Promise<void> {
  if (!ensurePostHogClient()) return Promise.resolve();
  posthog.capture(eventName, properties);
  return Promise.resolve();
}

function buildBaseProperties(context?: AnalyticsContext): Properties {
  return {
    surface: "notebook",
    timestamp: new Date().toISOString(),
    workspace_id: context?.workspaceId,
    workspace_namespace: context?.workspaceNamespace,
    user_id: context?.userId,
  };
}

export function identifyUser(input: {
  id: string;
  email?: string | null;
  name?: string | null;
}): void {
  if (!ensurePostHogClient()) return;

  posthog.identify(input.id, {
    email: input.email ?? undefined,
    name: input.name ?? undefined,
  });
}

export function resetUser(): void {
  if (!ensurePostHogClient()) return;
  posthog.reset();
}

export function trackPageView(
  context?: AnalyticsContext,
): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return trackEvent("$pageview", {
    ...buildBaseProperties(context),
    $current_url: window.location.href,
    $pathname: window.location.pathname,
  });
}

export function trackNotebookUploadButtonClicked(
  input: AnalyticsEnvelope & { readonly sourceCountSnapshot: number },
): Promise<void> {
  return trackEvent("notebook_upload_button_clicked", {
    ...buildBaseProperties(input.context),
    source_count_snapshot: input.sourceCountSnapshot,
  });
}

export function trackNotebookDocumentUploadCompleted(input: {
  readonly context?: AnalyticsContext;
  uploadedCount: number;
  fileType: string;
  fileSizeBytes: number;
  sourceCountBefore: number;
  sourceCountAfter: number;
}): Promise<void> {
  return trackEvent("notebook_document_upload_completed", {
    ...buildBaseProperties(input.context),
    uploaded_count: input.uploadedCount,
    file_types: [input.fileType || "unknown"],
    total_size_bytes: input.fileSizeBytes,
    source_count_before: input.sourceCountBefore,
    source_count_after: input.sourceCountAfter,
  });
}

export function trackNotebookAssistantQuestionSubmitted(input: {
  readonly context?: AnalyticsContext;
  readonly threadId?: string | null;
  selectedSourcesCount: number;
  sourceCountSnapshot: number;
  messageLength: number;
}): Promise<void> {
  return trackEvent("notebook_assistant_question_submitted", {
    ...buildBaseProperties(input.context),
    thread_id: input.threadId,
    selected_sources_count: input.selectedSourcesCount,
    source_count_snapshot: input.sourceCountSnapshot,
    message_length: input.messageLength,
  });
}

export function trackNotebookDocumentUploadFailed(input: {
  readonly context?: AnalyticsContext;
  readonly fileType: string | null;
  readonly fileSizeBytes: number | null;
  readonly errorType: "network" | "validation" | "server" | "unknown";
  readonly errorMessage: string;
}): Promise<void> {
  return trackEvent("notebook_document_upload_failed", {
    ...buildBaseProperties(input.context),
    file_type: input.fileType,
    file_size_bytes: input.fileSizeBytes,
    error_type: input.errorType,
    error_message: input.errorMessage.slice(0, 200),
  });
}

export function trackNotebookAssistantAnswerCompleted(input: {
  readonly context?: AnalyticsContext;
  readonly threadId: string;
  readonly latencyMs: number;
}): Promise<void> {
  return trackEvent("notebook_assistant_answer_completed", {
    ...buildBaseProperties(input.context),
    thread_id: input.threadId,
    latency_ms: input.latencyMs,
  });
}

export function trackNotebookAssistantAnswerFailed(input: {
  readonly context?: AnalyticsContext;
  readonly threadId?: string | null;
  readonly latencyMs: number;
  readonly errorType: "network" | "validation" | "server" | "unknown";
  readonly errorMessage: string;
}): Promise<void> {
  return trackEvent("notebook_assistant_answer_failed", {
    ...buildBaseProperties(input.context),
    thread_id: input.threadId,
    latency_ms: input.latencyMs,
    error_type: input.errorType,
    error_message: input.errorMessage.slice(0, 200),
  });
}

export function trackNotebookWorkspaceFirstDocumentUploaded(input: {
  readonly context?: AnalyticsContext;
}): Promise<void> {
  return trackEvent("notebook_workspace_first_document_uploaded", {
    ...buildBaseProperties(input.context),
  });
}

export function trackNotebookWorkspaceFirstQuestionAsked(input: {
  readonly context?: AnalyticsContext;
  readonly selectedSourcesCount: number;
}): Promise<void> {
  return trackEvent("notebook_workspace_first_question_asked", {
    ...buildBaseProperties(input.context),
    selected_sources_count: input.selectedSourcesCount,
  });
}
