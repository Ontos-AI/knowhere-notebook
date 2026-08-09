import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("proxy", () => {
  const originalDashboardOrigin = process.env.DASHBOARD_ORIGIN;
  const originalKnowhereApiKey = process.env.KNOWHERE_API_KEY;

  beforeEach(() => {
    delete process.env.DASHBOARD_ORIGIN;
    delete process.env.KNOWHERE_API_KEY;
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
  });

  it("keeps anonymous source reads protected", () => {
    const sourcesResponse = proxy(
      new NextRequest("http://localhost:3001/api/sources"),
    );
    const chunksResponse = proxy(
      new NextRequest(
        "http://localhost:3001/api/sources/source-1/chunks",
      ),
    );

    expect(sourcesResponse.headers.get("location")).toBe(
      "http://localhost:3001/login",
    );
    expect(chunksResponse.headers.get("location")).toBe(
      "http://localhost:3001/login",
    );
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

  it("redirects protected routes to /login when no session cookie is present", () => {
    const response = proxy(
      new NextRequest("http://localhost:3001/api/sources/source-1", {
        method: "PATCH",
      }),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/login",
    );
  });

  it("lets anonymous auth routes through (login flows)", () => {
    const oauthStart = proxy(
      new NextRequest("http://localhost:3001/api/auth/google/start"),
    );
    const oauthCallback = proxy(
      new NextRequest("http://localhost:3001/api/auth/google/callback?code=x"),
    );
    const dashboardStart = proxy(
      new NextRequest("http://localhost:3001/api/auth/dashboard/start"),
    );

    expect(oauthStart.status).toBe(200);
    expect(oauthCallback.status).toBe(200);
    expect(dashboardStart.status).toBe(200);
  });
});
