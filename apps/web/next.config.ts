import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@kobako/db'],
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
  },
  serverExternalPackages: ['yauzl', 'saxes'],
};
export default nextConfig;
