import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kiswok/shared"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
