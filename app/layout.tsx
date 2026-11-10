import "./globals.css";

export const metadata = { title: "NEO · 增长决策工作台", description: "围绕经营证据开展本地原型演示。", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" } };

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
