import type { Metadata, Viewport } from "next";
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

const title = "Pattern Forge — Multi-market Workspace";
const description =
  "Explore public crypto candles and replay recorded gold, silver, oil and index contracts. Charts, selectable indicators and explained analysis.";
// SOURCE: Measured dimensions of the generated public/og.png social card.
const socialCardDimensions = { width: 1200, height: 630 };

export async function generateMetadata(): Promise<Metadata> {
  // SOURCE: existing public deployment, never caller-controlled forwarded headers.
  const socialCardUrl = "https://pattern-forge-five.vercel.app/og.png";
  const socialImage = socialCardUrl
    ? [
        {
          url: socialCardUrl,
          ...socialCardDimensions,
          alt: "Pattern Forge research workstation with a planned target and invalidated breakout",
        },
      ]
    : undefined;

  return {
    title: {
      default: title,
      template: "%s · Pattern Forge",
    },
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: socialImage,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: socialCardUrl ? [socialCardUrl] : undefined,
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#071014",
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
