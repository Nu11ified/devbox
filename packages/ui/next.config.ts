import type { NextConfig } from "next";

const serverUrl = process.env.API_SERVER_URL || "http://localhost:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-webgl"],
  async rewrites() {
    return [
      {
        source: "/api/ws/:path*",
        destination: `${serverUrl}/ws/:path*`,
      },
      {
        source: "/ws/:path*",
        destination: `${serverUrl}/ws/:path*`,
      },
      {
        source: "/api/auth/terminal/:path*",
        destination: `${serverUrl}/api/auth/terminal/:path*`,
      },
    ];
  },
};

export default nextConfig;
