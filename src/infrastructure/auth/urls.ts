const LOCALHOST_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

function buildDashboardLoginURL(
  dashboardLoginURL: string,
  notebookPublicURL: string,
): string {
  const url = new URL(dashboardLoginURL);
  url.searchParams.set("callbackURL", notebookPublicURL);
  return url.toString();
}

function resolveNotebookPublicURLFromHeaders(headers: Headers): string {
  const host = readFirstHeaderValue(headers, "x-forwarded-host") ?? headers.get("host");
  if (!host) {
    throw new Error(
      "NOTEBOOK_PUBLIC_URL is required when the request host is unavailable.",
    );
  }

  const protocol =
    readFirstHeaderValue(headers, "x-forwarded-proto") ?? inferProtocol(host);
  return `${protocol}://${host}`;
}

function readFirstHeaderValue(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (!value) return null;

  const first = value
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return first ?? null;
}

function inferProtocol(host: string): "http" | "https" {
  return LOCALHOST_HOSTNAMES.has(hostnameOf(host)) ? "http" : "https";
}

function hostnameOf(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  return host.split(":")[0] ?? host;
}

export const authURLs = {
  buildDashboardLoginURL,
  resolveNotebookPublicURLFromHeaders,
} as const;
