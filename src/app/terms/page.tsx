import type { Metadata } from 'next'
import { Pin } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'Pin Desk terms and conditions. Read our terms of service for using the Pinterest bulk pin scheduling platform.',
  alternates: {
    canonical: '/terms',
  },
}

export default function TermsPage() {
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
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Terms & Conditions</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: January 2026</p>

          <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
            <section>
              <h2 className="text-lg font-semibold text-foreground">1. Acceptance of Terms</h2>
              <p className="mt-3">
                By accessing and using Pin Desk (&quot;the Service&quot;) at <a href="https://pindesk.xyz" className="text-pin-600 hover:underline">https://pindesk.xyz</a>, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use our Service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">2. Description of Service</h2>
              <p className="mt-3">
                Pin Desk provides a Pinterest bulk pin scheduling SaaS platform. Users can connect Pinterest accounts via OAuth 2.0, upload pin data via CSV or manual entry, and schedule pins for automatic publishing through the official Pinterest API.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">3. Account Registration</h2>
              <p className="mt-3">
                You must register for an account to use the Service. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must provide accurate and complete information during registration.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">4. Pinterest Account Connection</h2>
              <p className="mt-3">
                By connecting your Pinterest account, you authorize Pin Desk to publish pins on your behalf through the official Pinterest API. You retain full ownership of your Pinterest content. You are responsible for ensuring that your pin content complies with Pinterest&apos;s Terms of Service and Community Guidelines.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">5. Acceptable Use</h2>
              <p className="mt-3">You agree not to:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Use the Service for any unlawful purpose</li>
                <li>Upload content that violates Pinterest&apos;s Terms of Service</li>
                <li>Attempt to reverse-engineer, hack, or disrupt the Service</li>
                <li>Share your account credentials with unauthorized third parties</li>
                <li>Use the Service to spam, harass, or harm others</li>
                <li>Exceed the pin limits specified in your plan</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">6. Pricing & Payments</h2>
              <p className="mt-3">
                Pin Desk offers Free, Pro, and Agency plans. Pricing is displayed on our website. We currently accept USDT (TRC20) for plan upgrades. Payment verification may take up to 24 hours. All sales are final unless otherwise stated.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">7. Account Suspension & Termination</h2>
              <p className="mt-3">
                We reserve the right to suspend or terminate accounts that violate these Terms. We may also suspend accounts if we detect suspicious or abusive activity. You may delete your account at any time from your settings.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">8. Disclaimer of Warranties</h2>
              <p className="mt-3">
                The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, either express or implied. We do not guarantee that the Service will be uninterrupted, error-free, or free of viruses or other harmful components.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">9. Limitation of Liability</h2>
              <p className="mt-3">
                Pin Desk shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service. Our total liability shall not exceed the amount paid by you in the 12 months preceding the claim.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">10. Changes to Terms</h2>
              <p className="mt-3">
                We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">11. Contact</h2>
              <p className="mt-3">
                For questions about these Terms, contact us at{' '}
                <a href="mailto:support@pindesk.xyz" className="text-pin-600 hover:underline">support@pindesk.xyz</a>.
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
