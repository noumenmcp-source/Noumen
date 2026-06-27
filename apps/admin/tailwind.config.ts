import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211c",
        field: "#f6f7f5",
        line: "#d9dfd8",
        accent: "#245f4d",
        danger: "#a24032",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(23, 33, 28, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
