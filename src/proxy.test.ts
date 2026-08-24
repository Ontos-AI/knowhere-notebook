import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("proxy", () => {
  const originalDashboardOrigin = process.env.DASHBOARD_ORIGIN;
  const originalKnowhereApiKey = process.env.KNOWHERE_API_KEY;
  const originalSessionCookieNames = process.env.SESSION_COOKIE_NAMES;

  beforeEach(() => {
    delete process.env.DASHBOARD_ORIGIN;
    delete process.env.KNOWHERE_API_KEY;
    delete process.env.SESSION_COOKIE_NAMES;
  });

  afterEach(() => {
    if (originalDashboardOrigin === undefined) {
      delete process.env.DASHBOARD_ORIGIN;
    } else {
      process.env.DASHBOARD_ORIGIN = originalDashboardOrigin;
    }
    if (originalKnowhereApiKey === undefined) {
      delete process.env.KNOWHERE_API_KEY;
    } else {
      process.env.KNOWHERE_API_KEY = originalKnowhereApiKey;
    }
    if (originalSessionCookieNames === undefined) {
      delete process.env.SESSION_COOKIE_NAMES;
    } else {
      process.env.SESSION_COOKIE_NAMES = originalSessionCookieNames;
    }
  });

  it("allows anonymous guest source reads", () => {
    const sourcesResponse = proxy(
      new NextRequest("http://localhost:3001/api/sources"),
    );
    const chunksResponse = proxy(
      new NextRequest(
        "http://localhost:3001/api/sources/demo-tsla-q4-2025/chunks",
      ),
    );
    const originalResponse = proxy(
      new NextRequest(
        "http://localhost:3001/api/demo-sources/demo-tsla-q4-2025/original",
      ),
    );
    const assetResponse = proxy(
      new NextRequest(
        "http://localhost:3001/api/demo-sources/demo-tsla-q4-2025/assets/images/image-1.jpg",
      ),
    );

    expect(sourcesResponse.headers.get("x-middleware-next")).toBe("1");
    expect(chunksResponse.headers.get("x-middleware-next")).toBe("1");
    expect(originalResponse.headers.get("x-middleware-next")).toBe("1");
    expect(assetResponse.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps anonymous source mutations protected", () => {
    const response = proxy(
      new NextRequest("http://localhost:3001/api/sources/source-1", {
        method: "PATCH",
      }),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/login",
    );
  });

  it("allows anonymous parsed-sync workflow callbacks", () => {
    const response = proxy(
      new NextRequest("http://localhost:3001/api/sources/parsed-sync", {
        method: "POST",
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows protected app routes without a session when KNOWHERE_API_KEY is configured", () => {
    process.env.KNOWHERE_API_KEY = "sk_dev_key";

    const response = proxy(
      new NextRequest("http://localhost:3001/api/sources/source-1", {
        method: "PATCH",
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("recognizes Dashboard session tokens with an environment prefix", () => {
    const response = proxy(
      new NextRequest("http://localhost:3001/inspect/doc-1/chunks", {
        headers: {
          cookie: "__Secure-better-auth-staging-session_token=token",
        },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not mistake Better Auth session data for a session token", () => {
    const response = proxy(
      new NextRequest("http://localhost:3001/inspect/doc-1/chunks", {
        headers: {
          cookie: "__Secure-better-auth-staging-session_data=data",
        },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/login",
    );
  });
});
