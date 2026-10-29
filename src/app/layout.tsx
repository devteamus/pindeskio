import type { Metadata, Viewport } from "next"
import Script from "next/script"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "sonner"
import { ThemeProvider } from "next-themes"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const SITE_URL = 'https://pindesk.xyz'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Pin Desk — Bulk Pinterest Pin Scheduler | Schedule Unlimited Pins",
    template: "%s | Pin Desk",
  },
  description:
    "Schedule unlimited Pinterest pins in bulk with Pin Desk. The #1 Pinterest bulk pin scheduler using the official Pinterest API. Upload CSV, auto-pace publishing, manage multiple accounts, and publish thousands of pins on autopilot. Free plan available.",
  applicationName: "Pin Desk",
  authors: [{ name: "Pin Desk", url: SITE_URL }],
  creator: "Pin Desk",
  publisher: "Pin Desk",
  keywords: [
    // Primary high-volume keywords
    "Pinterest bulk pin scheduler",
    "bulk schedule Pinterest pins",
    "Pinterest scheduler tool",
    "Pinterest automation tool",
    "Pinterest bulk upload",
    "schedule Pinterest pins",
    "Pinterest pin scheduler",
    "Pinterest auto poster",
    "Pinterest auto pinner",
    // Long-tail keywords (high-intent)
    "how to schedule Pinterest pins in bulk",
    "best Pinterest scheduling tool 2025",
    "Pinterest bulk pin scheduler free",
    "schedule 1000 Pinterest pins",
    "Pinterest CSV bulk upload tool",
    "Pinterest marketing automation tool",
    "Pinterest pin scheduling software",
    "Pinterest bulk posting tool",
    "auto publish Pinterest pins",
    "Pinterest content scheduler",
    // Niche-specific
    "Pinterest API scheduler",
    "Pinterest business scheduler",
    "Pinterest affiliate marketing tool",
    "Pinterest creator scheduler",
    "Pinterest agency tool",
    "Pinterest e-commerce scheduler",
    "Pinterest marketer tool",
    "unlimited Pinterest pins",
    "Pinterest pin queue",
    "Pinterest drip feed tool",
    // Comparison/alternative
    "Tailwind alternative",
    "Buffer alternative Pinterest",
    "Hootsuite alternative Pinterest",
    "Pinterest scheduler without limits",
    "cheapest Pinterest scheduler",
    // Problem-solving
    "Pinterest spam safe scheduler",
    "Pinterest safe pin scheduler",
    "Pinterest anti-ban scheduler",
    "Pinterest pacing tool",
    "Pinterest rate limit scheduler",
  ],
  category: "technology",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Pin Desk",
    title: "Pin Desk — Bulk Pinterest Pin Scheduler | Schedule Unlimited Pins",
    description:
      "Schedule unlimited Pinterest pins in bulk. Upload CSV, auto-pace publishing, manage multiple accounts. Uses official Pinterest API. Free plan available — start scheduling in 2 minutes.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Pin Desk — Bulk Pinterest Pin Scheduler",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@pindesk",
    creator: "@pindesk",
    title: "Pin Desk — Bulk Pinterest Pin Scheduler",
    description:
      "Schedule unlimited Pinterest pins in bulk. Official Pinterest API. CSV upload, auto-pacing, multi-account. Free plan available.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    other: [
      { rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#10b981" },
    ],
  },
  manifest: "/site.webmanifest",
  verification: {
    google: "google-site-verification-code-here",
  },
  other: {
    "msapplication-TileColor": "#10b981",
    "theme-color": "#10b981",
  },
}

export const viewport: Viewport = {
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#10b981' },
    { media: '(prefers-color-scheme: dark)', color: '#064e3b' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* DNS prefetch + preconnect for performance */}
        <link rel="dns-prefetch" href="https://api.pinterest.com" />
        <link rel="preconnect" href="https://api.pinterest.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* Google Analytics 4 — tracks traffic + revenue (G-J2KE00E1FY) */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-J2KE00E1FY"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-J2KE00E1FY', {
              // Enable enhanced measurement: page views, scrolls, outbound clicks,
              // site search, video engagement, file downloads
              send_page_view: true,
              // Allow Google Ads to use this data for conversion tracking
              allow_google_signals: true,
              allow_ad_personalization_signals: true,
            });
          `}
        </Script>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
