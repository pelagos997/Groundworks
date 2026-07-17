import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://groundwork-field-ops.jonanrones.chatgpt.site"),
  title: "Groundwork · Drilled Shaft Superintendent",
  description:
    "A phone-first, self-rescheduling superintendent for drilled-shaft field operations.",
  openGraph: {
    title: "Groundwork · Call the Superintendent",
    description:
      "Field crews call in changes. Groundwork verifies, replans, and coordinates the drilled-shaft week.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Groundwork drilled shaft superintendent control room",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Groundwork · Call the Superintendent",
    description: "A phone-first agent for drilled-shaft field operations.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
