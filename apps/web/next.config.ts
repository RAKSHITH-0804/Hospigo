import type { NextConfig } from 'next';

const AUTH_LINK_HEADERS = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store' },
];

const nextConfig: NextConfig = {
  // The browser-test stack (e2e/test-stack.cjs) builds into its own folder so it never touches the
  // .next folder of a dev server that is already running.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Next 16 writes AGENTS.md when the dev server starts. This repo does not use that file.
  agentRules: false,
  // The rest of the repo uses 127.0.0.1. Next blocks that host unless it is listed.
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: {
    position: 'bottom-right',
  },
  async headers() {
    return [
      { source: '/forgot-password', headers: AUTH_LINK_HEADERS },
      { source: '/reset-password', headers: AUTH_LINK_HEADERS },
      { source: '/activate', headers: AUTH_LINK_HEADERS },
    ];
  },
};

export default nextConfig;
