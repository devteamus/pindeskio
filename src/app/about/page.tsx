import type { Metadata } from 'next'
import { Pin, Check } from 'lucide-react'

export const metadata: Metadata = {
  title: 'About Us',
  description:
    'Learn about Pin Desk — the Pinterest bulk pin scheduling platform built for creators, marketers, agencies and businesses. Using the official Pinterest API for safe, automated pin publishing.',
  alternates: {
    canonical: '/about',
  },
}

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-2" aria-label="Pin Desk Home">
            <Pin className="size-6 text-pin-600" aria-hidden="true" />
            <span className="text-lg font-bold tracking-tight">Pin Desk</span>
          </a>
        </div>
      </header>

      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">About Pin Desk</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Pin Desk helps creators, marketers, agencies and businesses schedule Pinterest Pins in bulk using the official Pinterest API.
          </p>

          <div className="mt-12 space-y-10 text-sm leading-relaxed text-muted-foreground">
            <section>
              <h2 className="text-lg font-semibold text-foreground">Our Mission</h2>
              <p className="mt-3">
                We built Pin Desk because we saw a gap in the market: there was no reliable, safe, and affordable tool to bulk schedule Pinterest pins using the official API. Existing solutions either required sharing your password, used unofficial methods that risked account bans, or charged exorbitant prices.
              </p>
              <p className="mt-2">
                Pin Desk changes that. We use the official Pinterest API v5 with secure OAuth 2.0, offer transparent pricing, and build features that real Pinterest power users need — multi-account support, CSV bulk upload, auto-pacing, and background publishing.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">What Makes Pin Desk Different?</h2>
              <ul className="mt-3 space-y-3">
                {[
                  'Official Pinterest API integration — no password sharing, no unofficial methods',
                  'Auto-pacing engine that prevents spam-like publishing patterns',
                  'Background workers that publish pins 24/7, even when you are offline',
                  'Multi-account management with complete data isolation',
                  'CSV bulk upload with automatic validation',
                  'Transparent, affordable pricing with a generous free tier',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-pin-500" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">Who We Serve</h2>
              <p className="mt-3">
                Pin Desk is built for anyone who publishes content on Pinterest at scale:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><strong>Content Creators</strong> who want to maintain a consistent Pinterest presence</li>
                <li><strong>Affiliate Marketers</strong> who need to publish hundreds of product pins</li>
                <li><strong>Social Media Agencies</strong> managing multiple client accounts</li>
                <li><strong>E-Commerce Businesses</strong> driving traffic through Pinterest</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">Our Commitment to Safety</h2>
              <p className="mt-3">
                Account safety is our top priority. Pin Desk connects via OAuth 2.0 (the same authentication method Pinterest recommends), encrypts all tokens at rest, and uses intelligent auto-pacing to maintain natural publishing patterns. We never store your Pinterest password.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">Get in Touch</h2>
              <p className="mt-3">
                Have questions or feedback? We&apos;d love to hear from you.
              </p>
              <ul className="mt-2 space-y-2">
                <li>
                  Email:{' '}
                  <a href="mailto:support@pindesk.xyz" className="text-pin-600 hover:underline">support@pindesk.xyz</a>
                </li>
                <li>
                  Telegram:{' '}
                  <a href="https://t.me/AaruViestaa" target="_blank" rel="noopener noreferrer" className="text-pin-600 hover:underline">@AaruViestaa</a>
                </li>
                <li>
                  Website:{' '}
                  <a href="https://pindesk.xyz" className="text-pin-600 hover:underline">https://pindesk.xyz</a>
                </li>
              </ul>
            </section>
          </div>
        </article>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground">
            &copy; 2026 Pin Desk. All rights reserved. | Developed by{' '}
            <a href="https://www.linkedin.com/in/ifaisalh/" target="_blank" rel="noopener noreferrer" className="font-medium hover:text-pin-600 transition-colors">Faisal Hossain</a>
          </p>
        </div>
      </footer>
    </div>
  )
}
