import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Standing", template: "%s · Standing" },
  description: "Look up an AI agent's standing, or check agents on your site.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-sm">{children}</body>
    </html>
  );
}
