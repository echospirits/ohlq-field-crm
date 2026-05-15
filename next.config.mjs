/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  outputFileTracingIncludes: {
    '/api/admin/ohlq-manual-import': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/playwright-core/browsers.json',
    ],
    '/api/cron/ohlq-annual-sales': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/playwright-core/browsers.json',
    ],
  },
  serverExternalPackages: ['@sparticuz/chromium'],
};

export default nextConfig;
