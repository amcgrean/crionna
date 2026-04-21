import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // moved out of experimental in Next.js 15
  serverExternalPackages: ['@neondatabase/serverless'],
};

export default nextConfig;
