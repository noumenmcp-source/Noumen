import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CDP-US Admin",
  description: "Internal operations console for CDP-US",
};

export default function RootLayout(props: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{props.children}</body>
    </html>
  );
}
