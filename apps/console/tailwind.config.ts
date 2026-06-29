import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // AXIOM brand palette
        ink:   "#1c1510",   // primary text, dark header bg
        cream: "#f5f0e8",   // app background
        panel: "#faf7f2",   // card/panel bg
        line:  "#e0d8cc",   // borders
        muted: "#7a6e60",   // secondary text, labels
        gold:  "#c9a84c",   // money, VIP, accents
        sage:  "#4a7c59",   // positive signals, good channel
        rust:  "#c4683a",   // bad channel, losses
        // legacy aliases (so existing components don't break)
        field:  "#f5f0e8",
        accent: "#4a7c59",
        warn:   "#c4683a",
      },
      fontFamily: {
        serif: ["Lora", "Georgia", "serif"],
        mono:  ["'Geist Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 3px rgba(28, 21, 16, 0.08)",
        card:  "0 2px 8px rgba(28, 21, 16, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
