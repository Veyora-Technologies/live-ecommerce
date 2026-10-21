import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Arena preview is a development-only origin that differs from the
  // server's local hostname. This allowlist affects Next dev assets/HMR only.
  allowedDevOrigins: ["127.0.0.1", "*.e2b.app"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
