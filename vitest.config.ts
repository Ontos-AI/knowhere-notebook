import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `server-only` throws at import in non-RSC bundlers. Our unit tests are
    // already running server-side, so stub it out to a noop.
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
    alias: {
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url)
        .pathname,
    },
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts"],
    },
  },
});
