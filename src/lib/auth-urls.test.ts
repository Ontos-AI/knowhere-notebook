import { describe, expect, it } from "vitest";

import { authURLs } from "./auth-urls";

describe("buildDashboardLoginURL", () => {
  it("adds the Notebook callbackURL to the Dashboard login URL", () => {
    expect(
      authURLs.buildDashboardLoginURL(
        "http://localhost:3000/login",
        "http://localhost:3001",
      ),
    ).toBe("http://localhost:3000/login?callbackURL=http%3A%2F%2Flocalhost%3A3001");
  });
});

describe("resolveNotebookPublicURLFromHeaders", () => {
  it("derives a localhost Notebook origin from the request host", () => {
    const headers = new Headers({ host: "localhost:3001" });

    expect(authURLs.resolveNotebookPublicURLFromHeaders(headers)).toBe(
      "http://localhost:3001",
    );
  });

  it("prefers forwarded host and protocol behind a proxy", () => {
    const headers = new Headers({
      host: "127.0.0.1:3001",
      "x-forwarded-host": "notebook.knowhereto.ai",
      "x-forwarded-proto": "https",
    });

    expect(authURLs.resolveNotebookPublicURLFromHeaders(headers)).toBe(
      "https://notebook.knowhereto.ai",
    );
  });
});
