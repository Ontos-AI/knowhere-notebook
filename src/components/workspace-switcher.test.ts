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
  fetchKnowhereKeyNamespaces: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    activateWorkspace: mocks.activateWorkspace,
    createWorkspace: mocks.createWorkspace,
    fetchKnowhereKeyNamespaces: mocks.fetchKnowhereKeyNamespaces,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { WorkspaceSwitcher } from "./workspace-switcher";

const C = WorkspaceSwitcher as React.FC<Record<string, unknown>>;

const workspaces = [
  { id: "ws_a1", namespace: "quarterly", keyLabel: "domainA" },
  { id: "ws_a2", namespace: "investor-decks", keyLabel: "domainA" },
  { id: "ws_b1", namespace: "lab-papers", keyLabel: "domainB" },
];

const keyLabels = [
  { label: "domainA", mask: "sk_8aB••••GVB8" },
  { label: "domainB", mask: "sk_f3a••••e2" },
  { label: "domainC", mask: "sk_77c••••d1" },
];

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activateWorkspace.mockResolvedValue(undefined);
    mocks.createWorkspace.mockResolvedValue({
      id: "ws_c1",
      namespace: "new-ns",
      keyLabel: "domainC",
    });
    mocks.fetchKnowhereKeyNamespaces.mockResolvedValue([
      { namespace: "adobe", documentCount: 9 },
      { namespace: "docx", documentCount: 9 },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the active workspace label and lists workspaces grouped by domain", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(C, {
        activeWorkspace: workspaces[0],
        workspaces,
        knowhereKeyLabels: keyLabels,
      }),
    );

    expect(screen.getByText("domainA / quarterly")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /domainA \/ quarterly/ }));

    expect(await screen.findByText("investor-decks")).toBeTruthy();
    expect(screen.getByText("domainB")).toBeTruthy();
    expect(screen.getByText("lab-papers")).toBeTruthy();
  });

  it("shows '<username> / default' for a legacy workspace with a real user", () => {
    render(
      React.createElement(C, {
        activeWorkspace: {
          id: "ws_legacy",
          namespace: "notebook-83f3788f-53e9",
          keyLabel: null,
        },
        workspaces: [
          { id: "ws_legacy", namespace: "notebook-83f3788f-53e9", keyLabel: null },
        ],
        knowhereKeyLabels: keyLabels,
        userName: "Gordon",
      }),
    );

    expect(screen.getByText("Gordon / default")).toBeTruthy();
    expect(screen.queryByText(/notebook-83f3788f/u)).toBeNull();
  });

  it("activates a workspace and refreshes the router", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(C, {
        activeWorkspace: workspaces[0],
        workspaces,
        knowhereKeyLabels: keyLabels,
      }),
    );

    await user.click(screen.getByRole("button", { name: /domainA \/ quarterly/ }));
    await user.click(await screen.findByText("lab-papers"));

    await waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith("ws_b1");
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  it("creates a workspace for a key label and namespace pair", async () => {
    const user = userEvent.setup();
    let resolveNamespaces: (value: {
      namespace: string;
      documentCount: number;
    }[]) => void = () => {};
    mocks.fetchKnowhereKeyNamespaces.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNamespaces = resolve;
        }),
    );
    render(
      React.createElement(C, {
        activeWorkspace: workspaces[0],
        workspaces,
        knowhereKeyLabels: keyLabels,
      }),
    );

    await user.click(screen.getByRole("button", { name: /domainA \/ quarterly/ }));
    await user.click(await screen.findByText("New workspace…"));

    await user.click(await screen.findByRole("button", { name: /domainC/ }));
    expect(await screen.findByText("Loading namespaces…")).toBeTruthy();

    expect(mocks.fetchKnowhereKeyNamespaces).toHaveBeenCalledWith("domainC");

    resolveNamespaces([
      { namespace: "adobe", documentCount: 9 },
      { namespace: "docx", documentCount: 9 },
    ]);

    await user.click(await screen.findByText("adobe"));

    const createButton = screen.getByRole("button", { name: "Create workspace" });
    expect((createButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(createButton);

    await waitFor(() => {
      expect(mocks.createWorkspace).toHaveBeenCalledWith("domainC", "adobe");
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });
});
