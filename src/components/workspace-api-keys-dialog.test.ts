// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUserApiKey: vi.fn(),
  deleteUserApiKey: vi.fn(),
  fetchUserApiKeys: vi.fn(),
}));

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    createUserApiKey: mocks.createUserApiKey,
    deleteUserApiKey: mocks.deleteUserApiKey,
    fetchUserApiKeys: mocks.fetchUserApiKeys,
  },
}));

import { WorkspaceApiKeysDialog } from "./workspace-api-keys-dialog";

function renderDialog(props: {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onKeysChanged?: () => void;
  readonly userName?: string;
}) {
  return render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => new Map() } },
      React.createElement(WorkspaceApiKeysDialog, props),
    ),
  );
}

describe("WorkspaceApiKeysDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchUserApiKeys.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("calls onKeysChanged after a successful key add", async () => {
    const onKeysChanged = vi.fn();
    mocks.createUserApiKey.mockResolvedValue({
      key: {
        id: "key_new",
        label: "domainA",
        mask: "sk_te••••st",
        createdAt: new Date().toISOString(),
      },
      workspace: { id: "ws_default", namespace: "default" },
    });

    renderDialog({
        isOpen: true,
        onOpenChange: vi.fn(),
        onKeysChanged,
      });

    fireEvent.click(screen.getByRole("button", { name: "Add key" }));
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "domainA" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk_test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => {
      expect(mocks.createUserApiKey).toHaveBeenCalledWith(
        "domainA",
        "sk_test",
      );
      expect(onKeysChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("calls onKeysChanged after a key delete", async () => {
    const onKeysChanged = vi.fn();
    mocks.fetchUserApiKeys.mockResolvedValue([
      {
        id: "key_1",
        label: "domainA",
        mask: "sk_te••••st",
        createdAt: new Date().toISOString(),
      },
    ]);
    mocks.deleteUserApiKey.mockResolvedValue(undefined);

    renderDialog({
        isOpen: true,
        onOpenChange: vi.fn(),
        onKeysChanged,
      });

    await waitFor(() => {
      expect(screen.getByText("domainA")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete domainA" }));

    await waitFor(() => {
      expect(mocks.deleteUserApiKey).toHaveBeenCalledWith("key_1");
      expect(onKeysChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call onKeysChanged when the key add fails", async () => {
    const onKeysChanged = vi.fn();
    mocks.createUserApiKey.mockRejectedValue(
      new Error("Invalid API key. Check it and try again."),
    );

    renderDialog({
        isOpen: true,
        onOpenChange: vi.fn(),
        onKeysChanged,
      });

    fireEvent.click(screen.getByRole("button", { name: "Add key" }));
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "domainA" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk_bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid API key/)).toBeTruthy();
    });
    expect(onKeysChanged).not.toHaveBeenCalled();
  });
});
