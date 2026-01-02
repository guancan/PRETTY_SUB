import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
  reactCompiler: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '30mb', // Support audio files from up to 1 hour videos (optimized: 64kbps, mono, 16kHz)
    },
  },
};

export default nextConfig;
