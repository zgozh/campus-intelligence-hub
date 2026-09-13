import path from 'node:path';

const backendProxyTarget = process.env.BACKEND_PROXY_TARGET || 'http://localhost:8000';

// 构建标识（REFACTOR_PLAN_V2_2 A2）：由 docker compose 的 APP_BUILD 注入，
// 同时写入 NEXT_PUBLIC_BUILD_ID 与 Next 的 buildId，页面侧边栏可见、布局 data-build 可断言。
// 未提供时退化为时间戳（每次构建唯一即可用于辨别"是否最新构建"）。
const rawAppBuild = process.env.APP_BUILD || `dev-${Date.now()}`;
// 只保留文件名/缓存头安全字符
const appBuild = rawAppBuild.replace(/[^A-Za-z0-9._-]/g, '-');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  productionBrowserSourceMaps: false,
  env: {
    NEXT_PUBLIC_BUILD_ID: appBuild,
    NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION || '2.2.0',
    NEXT_PUBLIC_APP_ENV: process.env.APP_ENVIRONMENT || 'development',
  },
  async generateBuildId() {
    return appBuild;
  },
  webpack(config) {
    config.resolve.alias['react-router-dom'] = path.resolve('./src/router/react-router-dom.tsx');
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendProxyTarget}/api/:path*`,
      },
      {
        source: '/sdk.js',
        destination: `${backendProxyTarget}/sdk.js`,
      },
      {
        source: '/widget-demo',
        destination: `${backendProxyTarget}/widget-demo`,
      },
      {
        source: '/basjoo-logo.png',
        destination: `${backendProxyTarget}/basjoo-logo.png`,
      },
      {
        source: '/health',
        destination: `${backendProxyTarget}/health`,
      }
    ];
  },
};

export default nextConfig;
