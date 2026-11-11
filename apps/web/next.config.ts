import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next 16 writes AGENTS.md when the dev server starts. This repo does not use that file.
  agentRules: false,
  // The rest of the repo uses 127.0.0.1. Next blocks that host unless it is listed.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
