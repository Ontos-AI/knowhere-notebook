# GA4 Alignment for Notebook Storytelling v2

This document maps the Notebook storytelling events to GA4 naming and parameters.

## Naming policy

- Keep the same event names in PostHog and GA4.
- Keep the same parameter names and meanings in both systems.

## Shared user properties

- `workspace_id`
- `workspace_namespace`
- `is_guest`

## Event mapping

- `notebook_upload_button_clicked`
  - params: `source_count_snapshot`, `surface`
- `notebook_document_upload_completed`
  - params: `uploaded_count`, `file_types`, `total_size_bytes`, `source_count_before`, `source_count_after`
- `notebook_document_upload_failed`
  - params: `file_type`, `file_size_bytes`, `error_type`, `error_message`
- `notebook_assistant_question_submitted`
  - params: `thread_id`, `selected_sources_count`, `source_count_snapshot`, `message_length`
- `notebook_assistant_answer_completed`
  - params: `thread_id`, `latency_ms`
- `notebook_assistant_answer_failed`
  - params: `thread_id`, `latency_ms`, `error_type`, `error_message`
- `notebook_dashboard_link_clicked`
  - params: `from_page`, `target_url`, `has_sources`, `has_chats`
- `notebook_workspace_first_document_uploaded`
  - params: `surface`
- `notebook_workspace_first_question_asked`
  - params: `selected_sources_count`, `surface`

## GA4 implementation notes

- Send GA4 events from the same trigger points as PostHog.
- Attach `workspace_id`, `workspace_namespace`, and `is_guest` as GA4 user properties after auth state resolves.
- Keep `error_message` truncated to avoid oversized payloads.
