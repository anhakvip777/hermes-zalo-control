import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@hermes/shared"],

  // Proxy API calls through Next.js → backend (no CORS, works over Cloudflare)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3002/api/:path*",
      },
    ];
  },
};

export default nextConfig;
