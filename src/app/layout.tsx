import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Vocalizer — Local Audio Studio",
  description:
    "Offline-first, enterprise-grade local audio studio: waveform editor, cutter, joiner, pitcher, key & BPM finder, recorder, karaoke, and neural stem separation. Files never leave your computer.",
  keywords: ["audio", "local-first", "waveform", "cutter", "joiner", "pitch", "BPM", "karaoke", "separation", "stems"],
  authors: [{ name: "Local Audio Studio" }],
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground min-h-screen">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
