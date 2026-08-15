import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ashes-to-aurora-game-20260815.sea.chatgpt.site"),
  title: "追.光｜物理堆叠小游戏",
  description: "99 米以上才有光明与新的生命。努力向上攀爬，去看看吧。",
  openGraph: {
    title: "追.光｜物理堆叠小游戏",
    description: "99 米以上才有光明与新的生命。",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "追.光｜物理堆叠小游戏",
    description: "99 米以上才有光明与新的生命。",
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
