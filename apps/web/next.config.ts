import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@kobako/db'],
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
  },
  serverExternalPackages: ['yauzl', 'saxes'],
  async redirects() {
    return [
      {
        source: '/transactions/import',
        destination: '/settings/import',
        permanent: true,
      },
    ];
  },
};
export default nextConfig;
