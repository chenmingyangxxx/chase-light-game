import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ashes-to-aurora-game-20260815.sea.chatgpt.site"),
  title: "余烬之光｜物理堆叠小游戏",
  description: "在写实废土中堆叠回收物，攀上 99 米吊篮，摘取复苏的新芽。",
  openGraph: {
    title: "余烬之光｜物理堆叠小游戏",
    description: "用废弃物搭出通往光明的路。",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "余烬之光｜物理堆叠小游戏",
    description: "用废弃物搭出通往光明的路。",
    images: ["/og.png"],
  },
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
