import { afterEach, describe, expect, it, vi } from "vitest";

const constructorSpy = vi.fn();

vi.mock("@ontos-ai/knowhere-sdk", () => ({
  default: class FakeKnowhere {
    constructor(options: unknown) {
      constructorSpy(options);
    }
  },
}));

describe("getKnowhereClient", () => {
  const originalApiKey = process.env.KNOWHERE_API_KEY;
  const originalBaseURL = process.env.KNOWHERE_BASE_URL;

  afterEach(() => {
    vi.resetModules();
    constructorSpy.mockReset();
    restoreEnv("KNOWHERE_API_KEY", originalApiKey);
    restoreEnv("KNOWHERE_BASE_URL", originalBaseURL);
  });

  it("passes configured API base URL into the Knowhere SDK", async () => {
    process.env.KNOWHERE_API_KEY = "sk_test";
    process.env.KNOWHERE_BASE_URL = "https://api-staging.knowhereto.ai";

    const { getKnowhereClient } = await import("./knowhere");

    getKnowhereClient();

    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: "sk_test",
      baseURL: "https://api-staging.knowhereto.ai",
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
