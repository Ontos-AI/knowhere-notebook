import { afterEach, describe, expect, it, vi } from "vitest";

const constructorSpy = vi.fn();
const postSpy = vi.fn();
const getSpy = vi.fn();
const listSpy = vi.fn();

vi.mock("@ontos-ai/knowhere-sdk", () => ({
  default: class FakeKnowhere {
    readonly jobs: FakeJobs;
    readonly documents: FakeDocuments;
    readonly httpClient: FakeHttpClient;

    constructor(options: unknown) {
      constructorSpy(options);
      this.httpClient = {
        get: getSpy,
        post: postSpy,
      };
      this.jobs = new FakeJobs(this.httpClient);
      this.documents = new FakeDocuments();
    }
  },
}));

type FakeHttpClient = {
  get(path: string, config?: unknown): Promise<unknown>;
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
    getSpy.mockReset();
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

  it("passes active document listing through the SDK HTTP client until the public SDK type catches up", async () => {
    getSpy.mockResolvedValue({
      namespace: "default",
      documents: [],
      activeJobs: [
        {
          jobId: "job_1",
          documentId: "doc_1",
          namespace: "default",
          status: "running",
        },
      ],
    });

    const { makeKnowhereClient } = await import("./knowhere");

    const client = makeKnowhereClient("sk_test");
    const result = await client.documents.list({
      namespace: "default",
      includeActiveJobs: true,
    });

    expect(result.activeJobs).toHaveLength(1);
    expect(getSpy).toHaveBeenCalledWith("/v1/documents", {
      params: {
        namespace: "default",
        include_active_jobs: true,
      },
    });
    expect(listSpy).not.toHaveBeenCalled();
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
