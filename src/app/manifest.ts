import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "GymPulse",
    short_name: "GymPulse",
    description: "See which members may stop coming, remind them to renew, and win them back. Made for gyms in Nepal.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f3f8",
    theme_color: "#1a1530",
    categories: ["business", "health", "fitness"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pulse", url: "/app/pulse", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Check in", url: "/app/attendance", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
