import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply CORS headers to all API routes and t.js
        source: "/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            // Must specify exact origin when using credentials, not wildcard
            value: process.env.NODE_ENV === 'production'
              ? 'https://www.propradlo.cz'
              : 'http://localhost:3000',
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
          {
            key: "Access-Control-Allow-Credentials",
            value: "true",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
