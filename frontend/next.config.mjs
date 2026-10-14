/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@manycore/aholo-viewer', 'three', '@react-three/fiber', '@react-three/drei'],
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
