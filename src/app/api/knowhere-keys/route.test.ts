import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getCurrentUser: vi.fn(),
    getKnowhereKeyByLabel: vi.fn(),
    listKnowhereNamespaces: vi.fn(),
    listMaskedKnowhereKeys: vi.fn(),
  };
});

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/integrations/knowhere-keys", () => ({
  getKnowhereKeyByLabel: mocks.getKnowhereKeyByLabel,
  listMaskedKnowhereKeys: mocks.listMaskedKnowhereKeys,
}));

vi.mock("@/integrations/knowhere", () => ({
  listKnowhereNamespaces: mocks.listKnowhereNamespaces,
}));

import { GET as listKeys } from "./route";
import { GET as listNamespacesForLabel } from "./[label]/namespaces/route";

const user = { id: "user_1", email: "ada@example.com", name: "Ada" };

describe("GET /api/knowhere-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
  });

  it("returns masked key labels", async () => {
    mocks.listMaskedKnowhereKeys.mockResolvedValue([
      { label: "default", mask: "sk_te••••st" },
      { label: "domainA", mask: "sk_8aB••••GVB8" },
    ]);

    const response = await listKeys();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.keys).toEqual([
      { label: "default", mask: "sk_te••••st" },
      { label: "domainA", mask: "sk_8aB••••GVB8" },
    ]);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await listKeys();

    expect(response.status).toBe(400);
  });
});

describe("GET /api/knowhere-keys/[label]/namespaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
  });

  it("lists namespaces visible to the given key label", async () => {
    mocks.getKnowhereKeyByLabel.mockResolvedValue({
      label: "domainA",
      apiKey: "sk_domain_a",
    });
    mocks.listKnowhereNamespaces.mockResolvedValue([
      { namespace: "adobe", documentCount: 9 },
      { namespace: "docx", documentCount: 9 },
    ]);

    const response = await listNamespacesForLabel(new Request("http://localhost"), {
      params: Promise.resolve({ label: "domainA" }),
    });
    const body = await response.json();

    expect(mocks.getKnowhereKeyByLabel).toHaveBeenCalledWith("domainA");
    expect(mocks.listKnowhereNamespaces).toHaveBeenCalledWith("sk_domain_a");
    expect(response.status).toBe(200);
    expect(body.namespaces).toEqual([
      { namespace: "adobe", documentCount: 9 },
      { namespace: "docx", documentCount: 9 },
    ]);
  });

  it("returns 404 for an unknown key label", async () => {
    mocks.getKnowhereKeyByLabel.mockResolvedValue(null);

    const response = await listNamespacesForLabel(new Request("http://localhost"), {
      params: Promise.resolve({ label: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
