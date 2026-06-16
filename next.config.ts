import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  serverExternalPackages: [
    "pg",
    "@neondatabase/serverless",
    "postgres",
    "@antv/chart-visualization-skills",
  ],
  outputFileTracingIncludes: {
    "/api/chat/diagram": [
      "./node_modules/@antv/chart-visualization-skills/dist/index/**/*",
    ],
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "notebook.local.knowhereto.ai",
    "notebook.127.0.0.1.nip.io",
    "dashboard.127.0.0.1.nip.io",
  ],
};

export default nextConfig;
