// @vitest-environment node
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useHashFragment } from "./use-hash-fragment";

describe("useHashFragment", () => {
  it("can render on the server without reading window", () => {
    function HashFragmentProbe(): React.ReactElement {
      const [chunkId] = useHashFragment();
      return React.createElement("span", null, chunkId ?? "none");
    }

    expect(() => renderToString(React.createElement(HashFragmentProbe))).not.toThrow();
  });
});
