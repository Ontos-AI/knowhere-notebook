// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SourcesPanel } from "./sources-panel";

describe("SourcesPanel", () => {
  it("opens the upload dialog from the sidebar trigger", async () => {
    const user = userEvent.setup();

    render(React.createElement(SourcesPanel, { sources: [] }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(
      screen.getByRole("heading", { name: "Add Document Source" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Click to select or drag and drop a document/),
    ).toBeTruthy();
  });
});
