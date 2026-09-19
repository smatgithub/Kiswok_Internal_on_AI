import type { NextConfig } from "next";

const nestOrigin =
  process.env.API_PROXY_TARGET || "http://127.0.0.1:4010";

const nextConfig: NextConfig = {
  transpilePackages: ["@kiswok/shared"],
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${nestOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
