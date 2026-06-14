import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headers handled in middleware for dynamic CORS
  // async headers() { ... }

  // Google Ads' scheduled HTTPS upload only accepts a URL ending in .csv/.tsv,
  // so expose the export endpoint at a .csv path. Query string is preserved.
  async rewrites() {
    return [
      {
        source: "/api/export/google-conversions.csv",
        destination: "/api/export/google-conversions",
      },
    ];
  },
};

export default nextConfig;
