import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "notebook.127.0.0.1.nip.io",
    "dashboard.127.0.0.1.nip.io",
  ],
};

export default nextConfig;
