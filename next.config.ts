import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  reactCompiler: true,
  serverExternalPackages: [
    "pg",
    "@neondatabase/serverless",
    "postgres",
  ],
  allowedDevOrigins: [
    "127.0.0.1",
    "notebook.local.knowhereto.ai",
    "notebook.127.0.0.1.nip.io",
    "dashboard.127.0.0.1.nip.io",
  ],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
