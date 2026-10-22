import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NearZoop",
    short_name: "NearZoop",
    description:
      "Offers in your para, right now. Local deals, zero scrolling.",
    start_url: "/",
    display: "standalone",
    background_color: "#FB4B32",
    theme_color: "#FB4B32",
    icons: [
      {
        src: "/brand/app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
