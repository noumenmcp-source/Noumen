/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        ink: "#121917",
        moss: "#0b7558",
        leaf: "#d9f8ec",
        paper: "#f7f8f5",
        line: "#dfe5dc",
      },
      fontFamily: {
        sans: ["Avenir Next", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["SFMono-Regular", "Consolas", "monospace"],
      },
    },
  },
};
