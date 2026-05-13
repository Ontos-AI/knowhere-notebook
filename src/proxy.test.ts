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

  it("allows protected app routes without a session when KNOWHERE_API_KEY is configured", () => {
    process.env.KNOWHERE_API_KEY = "sk_dev_key";

    const response = proxy(
      new NextRequest("http://localhost:3001/api/sources/source-1", {
        method: "PATCH",
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
