import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#10201b",
        field: "#f5f7f4",
        line: "#d9e1d8",
        accent: "#1f7a5a",
        warn: "#a85b16",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(16, 32, 27, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
