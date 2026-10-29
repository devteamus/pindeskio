import type { Metadata } from 'next'
import { Pin } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Pin Desk privacy policy. Learn how we collect, use, and protect your data. Pin Desk helps creators, marketers, agencies and businesses schedule Pinterest Pins in bulk using the official Pinterest API.',
  alternates: {
    canonical: '/privacy',
  },
}

export default function PrivacyPage() {
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
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: January 2026</p>

          <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
            <section>
              <h2 className="text-lg font-semibold text-foreground">1. Introduction</h2>
              <p className="mt-3">
                Pin Desk (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) operates the website <a href="https://pindesk.xyz" className="text-pin-600 hover:underline">https://pindesk.xyz</a>. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Pinterest bulk pin scheduling service.
              </p>
              <p className="mt-2">
                Pin Desk helps creators, marketers, agencies and businesses schedule Pinterest Pins in bulk using the official Pinterest API.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">2. Information We Collect</h2>
              <h3 className="mt-4 text-base font-medium text-foreground">2.1 Information You Provide</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Account information: name, email address, and password</li>
                <li>Pinterest account connections via OAuth 2.0 (access tokens, profile data)</li>
                <li>Pin data: titles, descriptions, image URLs, destination links, board selections</li>
                <li>Payment information: USDT transaction IDs for plan upgrades</li>
              </ul>

              <h3 className="mt-4 text-base font-medium text-foreground">2.2 Information Collected Automatically</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Device and browser information</li>
                <li>IP address and general geographic location</li>
                <li>Usage data and interaction patterns with our platform</li>
                <li>Log data (pages visited, features used, errors encountered)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">3. How We Use Your Information</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                <li>To provide, maintain, and improve our Pinterest scheduling service</li>
                <li>To authenticate your Pinterest accounts and publish pins on your behalf</li>
                <li>To process payment transactions and manage your subscription</li>
                <li>To communicate with you about your account, updates, and support</li>
                <li>To detect, prevent, and address fraud and security issues</li>
                <li>To comply with legal obligations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">4. Pinterest Data & API Tokens</h2>
              <p className="mt-3">
                When you connect a Pinterest account, we store the OAuth access token in encrypted form. We use these tokens exclusively to publish pins on your behalf through the official Pinterest API. We never share your tokens with third parties.
              </p>
              <p className="mt-2">
                You can disconnect your Pinterest account at any time from your dashboard, which revokes our access.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">5. Data Security</h2>
              <p className="mt-3">
                We implement industry-standard security measures to protect your data, including encryption at rest for sensitive information (tokens, passwords), secure authentication, and regular security reviews. However, no method of transmission over the Internet is 100% secure.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">6. Data Retention</h2>
              <p className="mt-3">
                We retain your account data for as long as your account is active. If you delete your account, we will remove your personal data within 30 days, except where retention is required by law.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">7. Third-Party Services</h2>
              <p className="mt-3">
                We use the Pinterest API to publish pins on your behalf. We do not sell, trade, or rent your personal information to third parties.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">8. Your Rights</h2>
              <p className="mt-3">You have the right to:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Access, update, or delete your personal information</li>
                <li>Disconnect your Pinterest accounts at any time</li>
                <li>Request a copy of your data</li>
                <li>Delete your account entirely</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">9. Changes to This Policy</h2>
              <p className="mt-3">
                We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the updated policy on this page with a new &quot;Last updated&quot; date.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">10. Contact Us</h2>
              <p className="mt-3">
                If you have questions about this Privacy Policy, please contact us at:{' '}
                <a href="mailto:support@pindesk.xyz" className="text-pin-600 hover:underline">support@pindesk.xyz</a>
              </p>
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
