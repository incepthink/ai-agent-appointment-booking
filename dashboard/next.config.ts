import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in a subfolder of the backend repo (which has its own lockfile),
  // so pin the workspace root to silence Next's multi-lockfile inference warning.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
