import type { Metadata, Viewport } from "next";
import { Archivo, Hanken_Grotesk } from "next/font/google";
import { Toaster } from "sonner";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker";
import { Motion3D } from "@/components/motion/motion-3d";
import { ScrollFallback } from "@/components/motion/scroll-fallback";
import { armMotionHandOff } from "@/components/motion/handoff";
import { PageTransition } from "@/components/motion/page-transition";
import "./globals.css";

const ui = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-ui", display: "swap", preload: false });
// Not preloaded: at ~90 KB (the width axis) a preload competes with the render-blocking stylesheet and holds back
// first paint on slow phones. It still swaps in as soon as the CSS asks for it, over a metric-matched fallback.
const display = Archivo({ subsets: ["latin"], variable: "--font-display-face", display: "swap", axes: ["wdth"], preload: false });

export const metadata: Metadata = {
  title: { default: "GymPulse", template: "%s · GymPulse" },
  description: "See which members may stop coming, remind them to renew, and win them back. Made for gyms in Nepal.",
  applicationName: "GymPulse",
  appleWebApp: { capable: true, title: "GymPulse", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0c1c" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${display.variable}`}>
      <body className="min-h-dvh antialiased">
        {/* Inline and first, so it is listening before the first-load entrance can end, ahead of any download. */}
        <script dangerouslySetInnerHTML={{ __html: `(${armMotionHandOff.toString()})()` }} />
        <PageTransition scope="area">{children}</PageTransition>
        <Toaster position="top-center" richColors closeButton />
        <ServiceWorkerRegistration />
        <Motion3D />
        <ScrollFallback />
      </body>
    </html>
  );
}
