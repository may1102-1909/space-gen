/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@pascal-app/core',
    '@pascal-app/viewer',
    '@pascal-app/editor',
    '@pascal-app/nodes',
    'three',
    '@react-three/fiber',
    '@react-three/drei',
  ],
  turbopack: {},
  // Always inline the e2e flag (empty when unset) so production bundles drop the test hooks entirely.
  env: {
    NEXT_PUBLIC_E2E: process.env.NEXT_PUBLIC_E2E ?? '',
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@manycore/aholo-viewer': false,
      };
    }
    return config;
  },
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    return [
      {
        source: '/_next/static/chunks/:worker(splat-worker.js|splat-sort-worker.js|transcoder-worker.js)',
        destination: '/:worker',
      },
      {
        source: '/_next/static/chunks/app/:worker(splat-worker.js|splat-sort-worker.js|transcoder-worker.js)',
        destination: '/:worker',
      },
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
