import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18181b",
        muted: "#71717a",
        field: "#f4f4f5",
        line: "#e4e4e7",
        accent: "#2563eb",
        sidebar: "#f9fafb",
        container: "#ffffff",
        warn: "#b45309",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(24, 24, 27, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
