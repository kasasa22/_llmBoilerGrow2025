import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV ?? 'dev',
    NEXT_PUBLIC_MODEL_NAME: process.env.NEXT_PUBLIC_MODEL_NAME ?? 'qwen3:8b',
    NEXT_PUBLIC_INNGEST_DASHBOARD_URL: process.env.NEXT_PUBLIC_INNGEST_DASHBOARD_URL ?? '',
  },
  poweredByHeader: false,
};

export default nextConfig;
