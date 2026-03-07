import type { NextConfig } from "next";

const serverUrl = process.env.API_SERVER_URL || "http://localhost:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/ws/:path*",
        destination: `${serverUrl}/ws/:path*`,
      },
    ];
  },
};

export default nextConfig;
