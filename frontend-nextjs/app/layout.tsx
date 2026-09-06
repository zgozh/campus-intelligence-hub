import type { Metadata } from 'next';
import '../src/index.css';
import { AppProviders } from '../src/components/AppProviders';

export const metadata: Metadata = {
  title: '校务智汇中台',
  description: '校务智汇中台 — AI 自动数据采集与知识管理平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
