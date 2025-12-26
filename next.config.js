/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    instrumentationHook: true
  },
  output: 'standalone'
};

module.exports = nextConfig;
