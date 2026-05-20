import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talking Head — EchoMimic V2",
  description: "Gera vídeos de pessoa falando a partir de foto + áudio.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-slate-50">{children}</body>
    </html>
  );
}
