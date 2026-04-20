import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/projects/:projectId/services/:serviceId/line-ma',
        destination: '/projects/:projectId/services/:serviceId/line/dashboard',
        permanent: false,
      },
      {
        source: '/projects/:projectId/services/:serviceId/line-ma/:path*',
        destination: '/projects/:projectId/services/:serviceId/line/:path*',
        permanent: false,
      },
    ]
  },
  eslint: {
    // ESLintはVercelのCI環境ではビルド時にスキップ（別途lintコマンドで実行）
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 型チェックはビルド時にスキップ（環境変数が未設定の場合のエラーを回避）
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.cdninstagram.com' },
      { protocol: 'https', hostname: 'scontent*.instagram.com' },
    ],
  },
  async headers() {
    // LP SDK の公開 API エンドポイントに CORS を許可する
    // 本番では ALLOWED_ORIGINS 環境変数でドメインを絞ること（カンマ区切り）
    // 例: ALLOWED_ORIGINS=https://lp.example.com,https://lp2.example.com
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
      : ['*']

    const corsHeaders = allowedOrigins.includes('*')
      ? [
          { key: 'Access-Control-Allow-Origin',  value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,x-api-key' },
        ]
      : [
          // 複数オリジンは Vary ヘッダーと合わせてサーバー側で動的に返す必要があるが
          // Next.js の静的 headers() では固定値のみのため、先頭オリジンのみ設定
          // 複数ドメイン対応が必要な場合は middleware.ts で動的に制御すること
          { key: 'Access-Control-Allow-Origin',  value: allowedOrigins[0] },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,x-api-key' },
          { key: 'Vary',                         value: 'Origin' },
        ]

    return [
      // LP SDK スクリプト本体
      {
        source: '/lp-sdk.js',
        headers: corsHeaders,
      },
      // LP 公開 API（計測データ受信）
      {
        source: '/api/public/lp/:path*',
        headers: corsHeaders,
      },
    ]
  },
}

export default nextConfig
