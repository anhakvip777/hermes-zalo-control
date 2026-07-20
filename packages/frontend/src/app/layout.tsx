import { Providers } from "../components/providers";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <title>Hermes Zalo Bridge</title>
        <style>{`.status-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;border-width:1px;border-style:solid}`}</style>
      </head>
      <body className="min-h-screen bg-[#0B1222] text-slate-200">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
