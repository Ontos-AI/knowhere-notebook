import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("proxy", () => {
  const originalDashboardOrigin = process.env.DASHBOARD_ORIGIN;

  beforeEach(() => {
    delete process.env.DASHBOARD_ORIGIN;
  });

  afterEach(() => {
    if (originalDashboardOrigin === undefined) {
      delete process.env.DASHBOARD_ORIGIN;
    } else {
      process.env.DASHBOARD_ORIGIN = originalDashboardOrigin;
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

    expect(sourcesResponse.headers.get("x-middleware-next")).toBe("1");
    expect(chunksResponse.headers.get("x-middleware-next")).toBe("1");
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
});
