/**
 * Name of the Notebook session cookie. Edge-safe (no server-only imports)
 * so the proxy can reference it without pulling the DB runtime into the
 * edge bundle.
 */
export const notebookSessionCookieName = "notebook-session"
