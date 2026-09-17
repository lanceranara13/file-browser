import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image runs .next/standalone: a self-contained server without node_modules.
  output: "standalone",
};

export default nextConfig;
