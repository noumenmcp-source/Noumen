import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cdp-us.example",
  integrations: [tailwind({ applyBaseStyles: false })],
});
