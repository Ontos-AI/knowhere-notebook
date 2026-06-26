import { afterEach, describe, expect, it, vi } from "vitest";

const constructorSpy = vi.fn();
const postSpy = vi.fn();
const listSpy = vi.fn();

vi.mock("@ontos-ai/knowhere-sdk", () => ({
  default: class FakeKnowhere {
    readonly jobs: FakeJobs;
    readonly documents: FakeDocuments;

    constructor(options: unknown) {
      constructorSpy(options);
      this.jobs = new FakeJobs({
        post: postSpy,
      });
      this.documents = new FakeDocuments();
    }
  },
}));

type FakeHttpClient = {
  post(path: string, input: unknown): Promise<unknown>;
};

class FakeJobs {
  constructor(private readonly httpClient: FakeHttpClient) { }

  async create(input: unknown): Promise<unknown> {
    return this.httpClient.post("/v1/jobs", input);
  }
}

class FakeDocuments {
  async list(input: unknown): Promise<unknown> {
    return listSpy(input);
  }
}

describe("makeKnowhereClient", () => {
  const originalBaseURL = process.env.KNOWHERE_BASE_URL;

  afterEach(() => {
    vi.resetModules();
    constructorSpy.mockReset();
    postSpy.mockReset();
    listSpy.mockReset();
    restoreEnv("KNOWHERE_BASE_URL", originalBaseURL);
  });

  it("passes configured API base URL into the Knowhere SDK", async () => {
    process.env.KNOWHERE_BASE_URL = "https://api-staging.knowhereto.ai";

    const { makeKnowhereClient } = await import("./knowhere");

    makeKnowhereClient("sk_test");

    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: "sk_test",
      baseURL: "https://api-staging.knowhereto.ai",
    });
  });

  it("preserves SDK resource method receivers when logging calls", async () => {
    postSpy.mockResolvedValue({
      jobId: "job_123",
      status: "waiting-file",
      sourceType: "file",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const { makeKnowhereClient } = await import("./knowhere");

    const client = makeKnowhereClient("sk_test");
    const job = await client.jobs.create({
      sourceType: "file",
      fileName: "example.pdf",
      namespace: "workspace_123",
    });

    expect(job).toMatchObject({
      jobId: "job_123",
      status: "waiting-file",
    });
    expect(postSpy).toHaveBeenCalledWith("/v1/jobs", {
      sourceType: "file",
      fileName: "example.pdf",
      namespace: "workspace_123",
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
