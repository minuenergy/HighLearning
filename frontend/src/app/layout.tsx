import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SocraTeach",
  description: "AI 소크라테스 튜터와 교사 대시보드를 함께 제공하는 학습 워크스페이스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
