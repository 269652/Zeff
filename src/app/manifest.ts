import type { MetadataRoute } from "next";

/**
 * Zeff as an app on a phone's home screen (Settings → Mobile access: through Tailscale, Zeff staying on this computer): its own window,
 * no browser bar, the icons of icon.svg, apple-icon.png and public/android-chrome-* (the favicon package of site/).
 * The gate lets this and the icons through before signing in (no data in them).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zeff",
    short_name: "Zeff",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
    // Long-press on the icon: straight to what waits for your yes (the review queue) and to the todos.
    shortcuts: [
      { name: "Review", short_name: "Review", url: "/heute#review" },
      { name: "Todos", short_name: "Todos", url: "/todos" },
    ],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
