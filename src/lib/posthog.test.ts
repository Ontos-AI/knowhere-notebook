// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  init: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    capture: mocks.capture,
    identify: mocks.identify,
    init: mocks.init,
    reset: mocks.reset,
  },
}));

import {
  identifyUser,
  initPostHogClient,
  isPostHogEnabled,
  resetUser,
} from "./posthog";

describe("posthog", () => {
  const originalKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const originalHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  afterEach(() => {
    vi.clearAllMocks();
    if (originalKey === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_KEY = originalKey;
    }
    if (originalHost === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_HOST = originalHost;
    }
  });

  it("returns false when no key is configured", () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    expect(isPostHogEnabled()).toBe(false);
  });

  it("returns true when a key is configured", () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    expect(isPostHogEnabled()).toBe(true);
  });

  it("identifies and resets users when key is configured", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    await initPostHogClient();
    await identifyUser({
      id: "user_1",
      email: "user@example.com",
      name: "User One",
    });
    await resetUser();

    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.identify).toHaveBeenCalledWith("user_1", {
      email: "user@example.com",
      name: "User One",
    });
    expect(mocks.reset).toHaveBeenCalledOnce();
  });

  it("falls back to default host when NEXT_PUBLIC_POSTHOG_HOST is blank", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "   ";
    const { initPostHogClient: initClient } = await import("./posthog");
    await initClient();

    expect(mocks.init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({
        api_host: "https://us.i.posthog.com",
      }),
    );
  });

  it("resets guest identity before capturing a pageview in the same effect flush", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    const { resetUser: resetGuest, trackPageView: trackView } =
      await import("./posthog");
    window.history.pushState({}, "", "/workspace/guest");

    resetGuest();
    await trackView();

    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(
      "$pageview",
      expect.objectContaining({
        $pathname: "/workspace/guest",
      }),
    );
    expect(mocks.reset.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.capture.mock.invocationCallOrder[0],
    );
  });

  it("tracks pageview with full url metadata", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    const { initPostHogClient: initClient, trackPageView: trackView } =
      await import("./posthog");
    window.history.pushState({}, "", "/workspace/test");
    await initClient();
    await trackView({
      workspaceId: "ws_1",
    });

    expect(mocks.capture).toHaveBeenCalledWith(
      "$pageview",
      expect.objectContaining({
        $current_url: window.location.href,
        $pathname: "/workspace/test",
        workspace_id: "ws_1",
      }),
    );
    const payload = mocks.capture.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(payload).not.toHaveProperty("from_page");
  });
});
