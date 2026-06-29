import type { Metadata } from "next";
import { Lora } from "next/font/google";
import "./globals.css";

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AXIOM",
  description: "Revenue OS for SMBs",
};

export default function RootLayout(props: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" className={lora.variable}>
      <body>{props.children}</body>
    </html>
  );
}
