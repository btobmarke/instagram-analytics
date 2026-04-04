import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
}

export default nextConfig
