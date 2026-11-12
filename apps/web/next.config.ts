import type { NextConfig } from 'next';

const AUTH_LINK_HEADERS = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store' },
];

const nextConfig: NextConfig = {
  // Next 16 writes AGENTS.md when the dev server starts. This repo does not use that file.
  agentRules: false,
  // The rest of the repo uses 127.0.0.1. Next blocks that host unless it is listed.
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [
      { source: '/forgot-password', headers: AUTH_LINK_HEADERS },
      { source: '/reset-password', headers: AUTH_LINK_HEADERS },
      { source: '/activate', headers: AUTH_LINK_HEADERS },
    ];
  },
};

export default nextConfig;
