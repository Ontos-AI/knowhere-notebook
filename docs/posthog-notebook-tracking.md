# PostHog Notebook Tracking Setup

This runbook configures the four baseline insights for Knowhere Notebook usage.

## Events

- `notebook_upload_button_clicked`
- `notebook_document_upload_completed`
- `notebook_assistant_question_submitted`
- `notebook_dashboard_link_clicked`

## Create the Insights

1. Open PostHog `Product Analytics -> Insights`.
2. Create a `Trends` insight named `Notebook - Upload Button Clicks`.
   - Series: event `notebook_upload_button_clicked`
   - Math: `Total count`
3. Create `Notebook - Uploaded Documents`.
   - Series: event `notebook_document_upload_completed`
   - Math: `Sum`
   - Property: `uploaded_count`
4. Create `Notebook - Avg Sources Per Question`.
   - Series: event `notebook_assistant_question_submitted`
   - Math: `Average`
   - Property: `selected_sources_count`
5. Create `Notebook - Dashboard Click Users`.
   - Series: event `notebook_dashboard_link_clicked`
   - Math: `Unique users`

## Dashboard

1. Open PostHog `Dashboards` and create `Notebook Tracking`.
2. Add all four insights above to this dashboard.
3. Use a rolling `Last 30 days` filter for product reviews.
