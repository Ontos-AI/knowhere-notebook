// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  fetchApiKeyNamespaces: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    activateWorkspace: mocks.activateWorkspace,
    createWorkspace: mocks.createWorkspace,
    fetchApiKeyNamespaces: mocks.fetchApiKeyNamespaces,
    fetchUserApiKeys: vi.fn(async () => []),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { WorkspaceSwitcher } from "./workspace-switcher";

const C = WorkspaceSwitcher as React.FC<Record<string, unknown>>;

const keyLabels = [
  { id: "key_a", label: "domainA", mask: "sk_8aB••••GVB8" },
  { id: "key_b", label: "domainB", mask: "sk_f3a••••e2" },
];

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activateWorkspace.mockResolvedValue(undefined);
    mocks.createWorkspace.mockResolvedValue({
      id: "ws_new",
      namespace: "adobe",
      activeKeyLabel: "domainA",
    });
    mocks.fetchApiKeyNamespaces.mockImplementation((keyId: string) => {
      if (keyId === "key_a") {
        return Promise.resolve([
          { namespace: "adobe", documentCount: 9 },
          { namespace: "docx", documentCount: 9 },
        ]);
      }
      return Promise.resolve([{ namespace: "lab-papers", documentCount: 3 }]);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows 'key / namespace' for the active workspace and lists namespaces per key", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(C, {
        activeWorkspace: {
          id: "ws_a1",
          namespace: "adobe",
          activeKeyLabel: "domainA",
        },
        workspaces: [{ id: "ws_a1", namespace: "adobe" }],
        knowhereKeyLabels: keyLabels,
      }),
    );

    expect(screen.getByText("domainA / adobe")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /domainA \/ adobe/ }));

    expect(await screen.findByText("domainA")).toBeTruthy();
    expect(await screen.findByText("docx")).toBeTruthy();
    expect(await screen.findByText("domainB")).toBeTruthy();
    expect(await screen.findByText("lab-papers")).toBeTruthy();
  });

  it("shows 'Add API key' when no keys are configured", () => {
    render(
      React.createElement(C, {
        activeWorkspace: undefined,
        workspaces: [],
        knowhereKeyLabels: [],
      }),
    );

    expect(screen.getByText("Add API key")).toBeTruthy();
  });

  it("creates a workspace by picking a namespace and refreshes", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(C, {
        activeWorkspace: {
          id: "ws_a1",
          namespace: "adobe",
          activeKeyLabel: "domainA",
        },
        workspaces: [{ id: "ws_a1", namespace: "adobe" }],
        knowhereKeyLabels: keyLabels,
      }),
    );

    await user.click(screen.getByRole("button", { name: /domainA \/ adobe/ }));
    await user.click(await screen.findByText("docx"));

    await waitFor(() => {
      expect(mocks.createWorkspace).toHaveBeenCalledWith("key_a", "docx");
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  it("labels an existing workspace as 'exists' and shows a check on the active one", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(C, {
        activeWorkspace: {
          id: "ws_a1",
          namespace: "adobe",
          activeKeyLabel: "domainA",
        },
        workspaces: [
          { id: "ws_a1", namespace: "adobe" },
          { id: "ws_a2", namespace: "docx" },
        ],
        knowhereKeyLabels: keyLabels,
      }),
    );

    await user.click(screen.getByRole("button", { name: /domainA \/ adobe/ }));

    await waitFor(() => {
      expect(screen.getAllByText("exists")).toHaveLength(1);
    });
  });
});
