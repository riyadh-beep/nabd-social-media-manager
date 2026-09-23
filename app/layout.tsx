import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./studio.css";
import "./accounts.css";
import "./inbox.css";
import "./preferences.css";
import { PreferencesProvider } from "./components/preferences";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {

  return {
    title: "Nabd — Your content workspace",
    description: "Plan, create, approve, and manage social content for stores, creators, businesses, and news channels.",
    icons: { icon: "/signaldesk-logo.png", shortcut: "/signaldesk-logo.png" },
    openGraph: { title: "Nabd", description: "Your social content workspace." },
    twitter: { card: "summary", title: "Nabd", description: "Your social content workspace." },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
