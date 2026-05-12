/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  outputFileTracingIncludes: {
    '/api/cron/ohlq-annual-sales': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },
  serverExternalPackages: ['@sparticuz/chromium'],
};

export default nextConfig;
