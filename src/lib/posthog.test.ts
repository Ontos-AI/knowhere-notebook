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

  afterEach(() => {
    vi.clearAllMocks();
    if (originalKey === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_KEY = originalKey;
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
});
