import type { Metadata } from 'next'
import { Pin, Mail, Send, Clock, Globe } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Contact Us',
  description:
    'Contact Pin Desk support. Get help with your Pinterest bulk pin scheduling account. Email support or chat with us on Telegram.',
  alternates: {
    canonical: '/contact',
  },
}

export default function ContactPage() {
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
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Contact Us</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Need help with Pin Desk? We&apos;re here to assist you.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {/* Email Support */}
            <div className="rounded-lg border bg-card p-6">
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-pin-100 dark:bg-pin-900/40">
                <Mail className="size-5 text-pin-600 dark:text-pin-400" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold">Email Support</h2>
              <a
                href="mailto:support@pindesk.xyz"
                className="mt-2 block text-sm text-pin-600 hover:underline"
              >
                support@pindesk.xyz
              </a>
              <p className="mt-3 text-sm text-muted-foreground">
                For account issues, billing questions, or general inquiries.
              </p>
            </div>

            {/* Telegram */}
            <div className="rounded-lg border bg-card p-6">
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-[#0088cc]/10">
                <Send className="size-5 text-[#0088cc]" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold">Telegram Support</h2>
              <a
                href="https://t.me/AaruViestaa"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-pin-600 hover:underline"
              >
                @AaruViestaa
              </a>
              <p className="mt-3 text-sm text-muted-foreground">
                For faster support, chat with us directly on Telegram.
              </p>
            </div>

            {/* Response Time */}
            <div className="rounded-lg border bg-card p-6">
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-pin-100 dark:bg-pin-900/40">
                <Clock className="size-5 text-pin-600 dark:text-pin-400" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold">Response Time</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Usually within 24 hours. Telegram messages may get faster responses.
              </p>
            </div>

            {/* Website */}
            <div className="rounded-lg border bg-card p-6">
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-pin-100 dark:bg-pin-900/40">
                <Globe className="size-5 text-pin-600 dark:text-pin-400" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold">Website</h2>
              <a
                href="https://pindesk.xyz"
                className="mt-2 block text-sm text-pin-600 hover:underline"
              >
                https://pindesk.xyz
              </a>
              <p className="mt-3 text-sm text-muted-foreground">
                Visit our homepage to learn more about Pin Desk features and pricing.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-lg border bg-muted/40 p-6">
            <h2 className="text-base font-semibold">Before Contacting Us</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Please check our <a href="/faq" className="text-pin-600 hover:underline">FAQ section</a> for answers to common questions about Pin Desk, including how the service works, pricing, account safety, and more.
            </p>
          </div>
        </div>
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
