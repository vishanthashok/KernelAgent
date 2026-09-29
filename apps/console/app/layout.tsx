import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
// Display serif for the landing page's headings.
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"] });

const DESCRIPTION =
  "Run AI agents like OS processes: a scheduler, permission-checked syscalls, sandboxes, and a replayable event log. Bring your own Claude or OpenAI key.";

export const metadata: Metadata = {
  // Absolute URLs for the Open Graph image. Vercel sets VERCEL_PROJECT_PRODUCTION_URL.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  ),
  title: "KernelAgent",
  description: DESCRIPTION,
  openGraph: { title: "KernelAgent", description: DESCRIPTION, type: "website", siteName: "KernelAgent" },
  twitter: { card: "summary_large_image", title: "KernelAgent", description: DESCRIPTION },
};

// Dark is the default and is set on <html> in the markup, so the first paint is dark. This
// runs before paint and switches to light only if the viewer picked it with the theme toggle.
const THEME_SCRIPT = `try{if(localStorage.getItem("kernelagent.theme")==="light")delete document.documentElement.dataset.theme}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${jetbrains.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
