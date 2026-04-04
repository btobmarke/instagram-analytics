export const dynamic = 'force-dynamic'

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Instagram Analytics",
  description: "Instagram分析ダッシュボード",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full bg-gray-50 text-gray-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
