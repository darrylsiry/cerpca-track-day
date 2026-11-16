import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Database drivers and web-push load native/WASM assets from their own package
  // folders, so they must stay external to the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "web-push"],
  experimental: {
    serverActions: {
      // Signatures, incident sketches and paper tech-form photos are posted through Server Actions.
      bodySizeLimit: "8mb",
    },
  },
  turbopack: {
    // Pin the workspace root to this folder (there is another lockfile higher up the tree).
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
