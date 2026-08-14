import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "余烬之光｜物理堆叠小游戏",
  description: "用废弃物搭出通往光明的路。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
