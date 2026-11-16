import type { MetadataRoute } from "next";

/** Lets drivers add Track Day to their Home Screen, which is also what enables notifications on iPhone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Track Day",
    short_name: "Track Day",
    description: "Schedules, tech inspection, instruction and event operations for PCA driver education weekends.",
    id: "/home",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eceef0",
    theme_color: "#eceef0",
    categories: ["sports", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Schedule", url: "/schedule" },
      { name: "Track guide", url: "/track" },
      { name: "Alerts", url: "/alerts" },
    ],
  };
}
