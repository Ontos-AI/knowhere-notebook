import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["pg", "@neondatabase/serverless", "postgres"],
  allowedDevOrigins: [
    "notebook.local.knowhereto.ai",
    "notebook.127.0.0.1.nip.io",
    "dashboard.127.0.0.1.nip.io",
  ],
};

export default nextConfig;
