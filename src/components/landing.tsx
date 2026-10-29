'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import {
  Pin,
  Menu,
  Users,
  FileSpreadsheet,
  Server,
  CreditCard,
  Link2,
  Upload,
  Zap,
  Check,
  ArrowRight,
  Shield,
  Clock,
  BarChart3,
  Globe,
  Send,
  Star,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useAppStore } from '@/store'

/* ------------------------------------------------------------------ */
/*  Reusable fade-in wrapper                                          */
/* ------------------------------------------------------------------ */
function FadeIn({
  children,
  className,
  delay = 0,
  direction = 'up',
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  direction?: 'up' | 'down' | 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const dirs: Record<string, { x: number; y: number }> = {
    up: { x: 0, y: 24 },
    down: { x: 0, y: -24 },
    left: { x: 24, y: 0 },
    right: { x: -24, y: 0 },
  }
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, ...dirs[direction] }}
      animate={inView ? { opacity: 1, x: 0, y: 0 } : {}}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Telegram Floating Button                                          */
/* ------------------------------------------------------------------ */
function TelegramButton() {
  const [show, setShow] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!dismissed) setShow(true)
    }, 5000)
    return () => clearTimeout(timer)
  }, [dismissed])

  if (dismissed) {
    return (
      <a
        href="https://t.me/AaruViestaa"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on Telegram"
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-[calc(1.5rem+env(safe-area-inset-right,0px))] z-50 flex size-14 items-center justify-center rounded-full bg-[#0088cc] text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
      >
        <Send className="size-6" />
      </a>
    )
  }

  return (
    <div className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-[calc(1.5rem+env(safe-area-inset-right,0px))] z-50 flex flex-col items-end gap-2">
      {show && (
        <div className="animate-in slide-in-from-bottom-4 fade-in duration-300 max-w-xs rounded-lg border bg-background p-4 shadow-lg">
          <button
            onClick={() => setDismissed(true)}
            className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss tooltip"
          >
            <X className="size-3.5" />
          </button>
          <p className="text-sm font-medium">Need Help?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Chat with us on Telegram for instant support.
          </p>
        </div>
      )}
      <a
        href="https://t.me/AaruViestaa"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on Telegram"
        className="flex size-14 items-center justify-center rounded-full bg-[#0088cc] text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
      >
        <Send className="size-6" />
      </a>
    </div>
  )
}

/* ================================================================== */
/*  NAVBAR                                                            */
/* ================================================================== */
function Navbar() {
  const { setShowLoginModal, setShowSignupModal } = useAppStore()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollTo = (id: string) => {
    setMobileOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  const navLinks = [
    { label: 'Features', id: 'features' },
    { label: 'Benefits', id: 'benefits' },
    { label: 'How It Works', id: 'how-it-works' },
    { label: 'Pricing', id: 'pricing' },
    { label: 'FAQ', id: 'faq' },
  ]

  return (
    <header
      className={`sticky top-0 z-40 w-full border-b transition-colors duration-200 ${
        scrolled ? 'bg-background/80 backdrop-blur-md' : 'bg-background'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2" aria-label="Pin Desk Home">
          <Pin className="size-6 text-pin-600" aria-hidden="true" />
          <span className="text-lg font-bold tracking-tight">Pin Desk</span>
        </a>

        {/* Desktop nav */}
        <div className="hidden items-center gap-6 lg:flex">
          {navLinks.map((link) => (
            <button
              key={link.id}
              onClick={() => scrollTo(link.id)}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </button>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-3 lg:flex">
          <Button variant="outline" size="sm" onClick={() => setShowLoginModal(true)}>
            Login
          </Button>
          <Button size="sm" onClick={() => setShowSignupModal(true)}>
            Start Scheduling Free
          </Button>
        </div>

        {/* Mobile hamburger */}
        <div className="lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" aria-label="Open navigation menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] max-w-[80vw]">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Pin className="size-5 text-pin-600" />
                  Pin Desk
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-1 px-4" aria-label="Mobile navigation">
                {navLinks.map((link) => (
                  <button
                    key={link.id}
                    onClick={() => scrollTo(link.id)}
                    className="rounded-md px-3 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80"
                  >
                    {link.label}
                  </button>
                ))}
                <div className="mt-4 flex flex-col gap-3 border-t pt-4">
                  <Button
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => {
                      setMobileOpen(false)
                      setShowLoginModal(true)
                    }}
                  >
                    Login
                  </Button>
                  <Button
                    className="min-h-[44px]"
                    onClick={() => {
                      setMobileOpen(false)
                      setShowSignupModal(true)
                    }}
                  >
                    Start Scheduling Free
                  </Button>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  )
}

/* ================================================================== */
/*  HERO                                                              */
/* ================================================================== */
function Hero() {
  const { setShowSignupModal } = useAppStore()
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-pin-50 via-rose-50 to-orange-50 dark:from-pin-950/40 dark:via-rose-950/30 dark:to-orange-950/20">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-40 right-0 h-[300px] w-[300px] rounded-full bg-pin-200/40 blur-3xl sm:h-[500px] sm:w-[500px] dark:bg-pin-800/20" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-20 left-0 h-[250px] w-[250px] rounded-full bg-rose-200/40 blur-3xl sm:h-[400px] sm:w-[400px] dark:bg-rose-800/20" aria-hidden="true" />

      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-28 lg:px-8 lg:py-40">
        <FadeIn className="mx-auto max-w-3xl text-center">
          <Badge variant="secondary" className="mb-4 gap-1.5 px-3 py-1 text-xs sm:text-sm">
            <Zap className="size-3 sm:size-3.5" aria-hidden="true" />
            Official Pinterest API — Trusted by 500+ creators
          </Badge>

          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl md:text-5xl lg:text-6xl">
            Bulk Schedule Pinterest Pins{' '}
            <span className="bg-gradient-to-r from-pin-600 to-rose-500 bg-clip-text text-transparent dark:from-pin-400 dark:to-rose-300">
              Safely & Automatically
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg sm:leading-relaxed">
            Pin Desk is the <strong>#1 Pinterest bulk pin scheduler</strong> that uses the official Pinterest API. <strong>Schedule unlimited Pinterest pins</strong> in bulk — upload CSV files, auto-pace publishing across days, manage multiple Pinterest accounts, and let our background workers publish thousands of pins on autopilot. Close your browser — your pins still go live.
          </p>

          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground/80 sm:mt-4 sm:text-base">
            Built for <strong>Pinterest creators</strong>, <strong>affiliate marketers</strong>, <strong>social media agencies</strong>, <strong>e-commerce businesses</strong>, and <strong>bloggers</strong> who need to publish Pinterest pins at scale — without getting flagged as spam.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:mt-10 sm:flex-row sm:gap-4">
            <Button
              size="lg"
              className="w-full gap-2 px-6 text-base sm:w-auto sm:px-8"
              onClick={() => setShowSignupModal(true)}
            >
              Start Scheduling Free
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2 px-6 text-base sm:w-auto sm:px-8"
              onClick={() => scrollTo('how-it-works')}
            >
              See How It Works
            </Button>
          </div>

          {/* Trust signals */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground sm:mt-12 sm:gap-6 sm:text-sm">
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-pin-500 sm:size-4" aria-hidden="true" />
              Official Pinterest API v5
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-pin-500 sm:size-4" aria-hidden="true" />
              No password needed
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-pin-500 sm:size-4" aria-hidden="true" />
              Background publishing
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-pin-500 sm:size-4" aria-hidden="true" />
              Multi-account support
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-pin-500 sm:size-4" aria-hidden="true" />
              No credit card required
            </span>
          </div>

          {/* SEO hidden text — helps search engines understand the page */}
          <p className="sr-only">
            Pin Desk is the best Pinterest bulk pin scheduler for 2025. Schedule unlimited Pinterest pins in bulk,
            automate Pinterest marketing, manage multiple Pinterest accounts, and publish pins on autopilot.
            Use the official Pinterest API to safely schedule pins without getting banned. Free plan available —
            150 pins per month, 1 Pinterest account, CSV bulk upload. Upgrade to Pro ($49/mo) for 75,000 pins
            per month and 10 accounts, or Agency ($499/mo) for 1,500,000 pins per month and 100 accounts.
            Pinterest automation tool, Pinterest scheduling software, Pinterest bulk upload, auto poster,
            content scheduler, drip feed tool, pin queue, rate limit safe scheduler.
          </p>
        </FadeIn>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  WHAT IS PINDESK (AEO Section)                                     */
/* ================================================================== */
function WhatIsPinDeskSection() {
  return (
    <section className="bg-background py-14 sm:py-20 lg:py-28" aria-labelledby="what-is-pindesk">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-3xl text-center">
          <h2 id="what-is-pindesk" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            What is Pin Desk?
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg">
            <strong>Pin Desk</strong> is a <strong>Pinterest marketing tool</strong> and <strong>bulk pin scheduler</strong> that helps you schedule and publish Pinterest pins in bulk using the <strong>official Pinterest API</strong>. Whether you are a content creator, affiliate marketer, agency, or e-commerce business — Pin Desk automates your entire Pinterest publishing workflow.
          </p>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:mt-4 sm:text-lg">
            Unlike other tools that require your Pinterest password, Pin Desk connects via secure OAuth 2.0 — the same way Pinterest itself authenticates third-party apps. Your credentials are never stored. Your tokens are encrypted at rest.
          </p>
        </FadeIn>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  FEATURES                                                          */
/* ================================================================== */
const features = [
  {
    icon: Users,
    title: 'Multi-Account Management',
    description:
      'Connect and manage multiple Pinterest accounts with complete data isolation. Each account operates independently — no cross-contamination, no conflicts.',
  },
  {
    icon: FileSpreadsheet,
    title: 'CSV Bulk Scheduling',
    description:
      'Upload CSV files with thousands of pins. Pin Desk validates your data automatically and schedules every pin with intelligent auto-pacing.',
  },
  {
    icon: Server,
    title: 'Background Publishing',
    description:
      'Close your browser and your pins keep publishing. Server-side workers handle everything reliably — 24/7, without any manual intervention.',
  },
  {
    icon: Link2,
    title: 'Official Pinterest API',
    description:
      'Connect via secure OAuth 2.0 using the official Pinterest API v5. No passwords needed. Fully compliant with Pinterest\'s terms of service.',
  },
  {
    icon: Zap,
    title: 'Auto-Pacing Engine',
    description:
      'Pin Desk distributes your scheduled pins across days to maintain a natural, human-like publishing pattern. Prevents spam detection.',
  },
  {
    icon: Shield,
    title: 'Account Safety',
    description:
      'Encrypted tokens, isolated accounts, automatic retry with backoff, and daily limits. Your Pinterest accounts stay safe and healthy.',
  },
  {
    icon: BarChart3,
    title: 'Organic Analytics & Logs',
    description:
      'Live Pinterest organic analytics — impressions, pin clicks, saves, engagement rate, and your top pins — pulled straight from the official Pinterest API, plus complete publish logs and retry history.',
  },
  {
    icon: CreditCard,
    title: 'Transparent Pricing',
    description:
      'Start free, upgrade when you need scale. Clear pin quotas per plan with no hidden fees. Pay via USDT (TRC20) for instant activation.',
  },
]

function Features() {
  return (
    <section id="features" className="bg-muted/40 py-14 sm:py-20 lg:py-28" aria-labelledby="features-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <h2 id="features-heading" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Powerful Features for Pinterest Growth
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:mt-4 sm:text-lg">
            Everything you need to <strong>bulk schedule Pinterest pins</strong> and scale your Pinterest marketing — all in one platform.
          </p>
        </FadeIn>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <FadeIn key={f.title} delay={i * 0.05}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-pin-100 dark:bg-pin-900/40">
                    <f.icon className="size-5 text-pin-600 dark:text-pin-400" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-base">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="leading-relaxed">
                    {f.description}
                  </CardDescription>
                </CardContent>
              </Card>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  BENEFITS                                                          */
/* ================================================================== */
const benefits = [
  {
    icon: Clock,
    title: 'Save Hours Every Week',
    description:
      'Stop manually creating and publishing pins one by one. Upload a CSV with hundreds or thousands of pins and let Pin Desk handle the publishing schedule automatically.',
  },
  {
    icon: Globe,
    title: 'Scale Your Reach',
    description:
      'Publish more pins consistently across multiple accounts. Consistent publishing is the #1 driver of Pinterest traffic and engagement growth.',
  },
  {
    icon: Shield,
    title: 'Keep Your Accounts Safe',
    description:
      'Auto-pacing prevents spam-like behavior. Official API integration ensures compliance. Encrypted token storage protects your connections.',
  },
  {
    icon: BarChart3,
    title: 'Data-Driven Pinterest Strategy',
    description:
      'Track publishing history, monitor success rates, identify failures, and optimize your pin strategy with detailed logs and analytics.',
  },
  {
    icon: Users,
    title: 'Perfect for Teams & Agencies',
    description:
      'Manage up to 50 Pinterest accounts from a single dashboard. Assign connections, track per-account performance, and streamline agency workflows.',
  },
  {
    icon: Zap,
    title: 'Set It and Forget It',
    description:
      'Schedule pins days, weeks, or months in advance. Our background workers publish them on time — even when you are offline or asleep.',
  },
]

function Benefits() {
  return (
    <section id="benefits" className="bg-background py-14 sm:py-20 lg:py-28" aria-labelledby="benefits-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <h2 id="benefits-heading" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Why Choose Pin Desk for Pinterest Automation?
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:mt-4 sm:text-lg">
            Pin Desk gives you the tools to grow your Pinterest presence efficiently and safely.
          </p>
        </FadeIn>

        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((b, i) => (
            <FadeIn key={b.title} delay={i * 0.08}>
              <div className="flex gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-pin-100 dark:bg-pin-900/40">
                  <b.icon className="size-5 text-pin-600 dark:text-pin-400" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">{b.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{b.description}</p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  HOW IT WORKS                                                      */
/* ================================================================== */
const steps = [
  {
    number: 1,
    icon: Link2,
    title: 'Connect Your Pinterest Account',
    description:
      'Authorize your Pinterest account via secure OAuth 2.0 through the official Pinterest API. No passwords needed — takes less than 30 seconds.',
  },
  {
    number: 2,
    icon: Upload,
    title: 'Upload Pins via CSV or Create Manually',
    description:
      'Bulk upload via CSV with auto-validation (title, description, link, image URL, board), or create individual pins with the visual editor.',
  },
  {
    number: 3,
    icon: Zap,
    title: 'Pin Desk Publishes Automatically',
    description:
      'Background workers publish your pins at the right pace — even when your browser is closed. Auto-pacing keeps your account safe.',
  },
]

function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-muted/40 py-14 sm:py-20 lg:py-28" aria-labelledby="how-it-works-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <h2 id="how-it-works-heading" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            How Does Pin Desk Work?
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:mt-4 sm:text-lg">
            Three simple steps to <strong>automate your Pinterest publishing</strong> and scale your content strategy.
          </p>
        </FadeIn>

        <div className="relative mt-16 grid gap-8 md:grid-cols-3">
          <div className="pointer-events-none absolute left-0 right-0 top-16 hidden h-0.5 bg-gradient-to-r from-pin-300 via-rose-300 to-orange-300 md:block" aria-hidden="true" />

          {steps.map((s, i) => (
            <FadeIn key={s.number} delay={i * 0.15}>
              <article className="relative flex flex-col items-center text-center">
                <div className="relative z-10 flex size-14 items-center justify-center rounded-full border-4 border-background bg-gradient-to-br from-pin-500 to-rose-500 shadow-lg">
                  <s.icon className="size-6 text-white" aria-hidden="true" />
                </div>
                <span className="mt-4 text-xs font-semibold uppercase tracking-widest text-pin-600 dark:text-pin-400">
                  Step {s.number}
                </span>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {s.description}
                </p>
              </article>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  USE CASES                                                         */
/* ================================================================== */
const useCases = [
  {
    title: 'Content Creators',
    description:
      'Schedule weeks of Pinterest content in one sitting. Upload your blog post images, set daily targets, and let Pin Desk keep your boards fresh and active.',
  },
  {
    title: 'Affiliate Marketers',
    description:
      'Bulk publish affiliate pins across multiple boards and accounts. CSV upload makes it easy to schedule thousands of product pins with unique links.',
  },
  {
    title: 'Marketing Agencies',
    description:
      'Manage up to 50 client Pinterest accounts from one dashboard. Track per-account stats, assign team members, and streamline your agency workflows.',
  },
  {
    title: 'E-Commerce Businesses',
    description:
      'Drive traffic to your store with consistent product pinning. Upload your product catalog as CSV and Pin Desk publishes to the right boards at the right pace.',
  },
]

function UseCases() {
  return (
    <section className="bg-background py-14 sm:py-20 lg:py-28" aria-labelledby="use-cases-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <h2 id="use-cases-heading" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Who Uses Pin Desk?
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:mt-4 sm:text-lg">
            Pin Desk is built for anyone who needs to <strong>bulk publish Pinterest pins</strong> at scale.
          </p>
        </FadeIn>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {useCases.map((uc, i) => (
            <FadeIn key={uc.title} delay={i * 0.08}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <h3 className="text-base font-semibold">{uc.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{uc.description}</p>
                </CardContent>
              </Card>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  PRICING                                                           */
/* ================================================================== */
interface PricingPlan {
  name: string
  price: string
  period: string
  description: string
  features: string[]
  popular?: boolean
  cta: string
}

const plans: PricingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    period: '/mo',
    description: 'Get started with the basics',
    features: [
      '1 Pinterest account',
      '150 pins per month',
      '5 pins per day',
      'Single pin creation',
      'CSV bulk upload (100 rows)',
      'Basic scheduling',
      'Create boards & board sync',
      'Email support',
    ],
    cta: 'Get Started Free',
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/mo',
    description: 'For serious creators & marketers',
    popular: true,
    features: [
      '10 Pinterest accounts',
      '250 pins/day per account',
      '75,000 pins per month',
      'CSV bulk upload',
      'Auto-pacing & scheduling',
      'Create boards & live board sync',
      'Pinterest organic analytics',
      'Retry logs & history',
      'Priority support',
    ],
    cta: 'Start Scheduling Free',
  },
  {
    name: 'Agency',
    price: '$499',
    period: '/mo',
    description: 'For teams & agencies at scale',
    features: [
      '100 Pinterest accounts',
      '500 pins/day per account',
      '1,500,000 pins per month',
      'CSV bulk upload',
      'Board manager & live sync',
      'Advanced organic analytics',
      'Team-ready features',
      'Advanced logs & history',
      'Dedicated support',
    ],
    cta: 'Contact Sales',
  },
]

function Pricing() {
  const { setShowSignupModal } = useAppStore()

  return (
    <section id="pricing" className="bg-muted/40 py-14 sm:py-20 lg:py-28" aria-labelledby="pricing-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <h2 id="pricing-heading" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Simple, Transparent Pricing
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:mt-4 sm:text-lg">
            Pick the plan that matches your scale. Upgrade anytime. No hidden fees.
          </p>
        </FadeIn>

        <div className="mt-16 grid items-start gap-6 md:grid-cols-3">
          {plans.map((plan, i) => (
            <FadeIn key={plan.name} delay={i * 0.1}>
              <Card
                className={`relative flex h-full flex-col ${
                  plan.popular
                    ? 'border-2 border-pin-500 shadow-lg shadow-pin-500/10'
                    : ''
                }`}
              >
                {plan.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-pin-500 px-3 py-1 text-white">
                    Most Popular
                  </Badge>
                )}
                <CardHeader className="text-center">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                    <span className="text-muted-foreground">{plan.period}</span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 size-4 shrink-0 text-pin-500" aria-hidden="true" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={plan.popular ? 'default' : 'outline'}
                    onClick={() => setShowSignupModal(true)}
                  >
                    {plan.cta}
                  </Button>
                </CardFooter>
              </Card>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  TESTIMONIALS (Placeholder)                                        */
/* ================================================================== */
const testimonials = [
  {
    name: 'Sarah M.',
    role: 'Pinterest Creator',
    content:
      'Pin Desk saved me 10+ hours per week. I upload my entire month\'s pins via CSV and the auto-pacing handles the rest. My traffic has doubled since I started using it.',
    rating: 5,
  },
  {
    name: 'David K.',
    role: 'Affiliate Marketer',
    content:
      'Managing 3 Pinterest accounts used to be a nightmare. With Pin Desk, I bulk-schedule across all accounts from one dashboard. The CSV upload is a game-changer.',
    rating: 5,
  },
  {
    name: 'Agency Pro Team',
    role: 'Digital Marketing Agency',
    content:
      'We manage Pinterest for 20+ clients. Pin Desk\'s Agency plan lets us handle all accounts from a single place. The background workers mean we never miss a publishing window.',
    rating: 5,
  },
]

function Testimonials() {
  return (
    <section className="bg-background py-14 sm:py-20 lg:py-28" aria-labelledby="testimonials-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <h2 id="testimonials-heading" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Loved by Pinterest Creators & Agencies
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:mt-4 sm:text-lg">
            See what our users say about their experience with Pin Desk.
          </p>
        </FadeIn>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t, i) => (
            <FadeIn key={t.name} delay={i * 0.1}>
              <Card className="h-full">
                <CardContent className="p-6">
                  {/* Stars */}
                  <div className="mb-4 flex gap-1" aria-label={`${t.rating} out of 5 stars`}>
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="size-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                    ))}
                  </div>
                  <blockquote className="text-sm leading-relaxed text-muted-foreground">
                    &ldquo;{t.content}&rdquo;
                  </blockquote>
                  <div className="mt-4 border-t pt-4">
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </CardContent>
              </Card>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  FAQ                                                               */
/* ================================================================== */
const faqs = [
  {
    question: 'What is Pin Desk?',
    answer:
      'Pin Desk is a Pinterest bulk pin scheduling SaaS platform that helps creators, marketers, agencies, and businesses schedule and publish Pinterest pins in bulk using the official Pinterest API. It supports multi-account management, CSV bulk upload, auto-pacing, and background publishing.',
  },
  {
    question: 'How does Pin Desk work?',
    answer:
      'Pin Desk works in three steps: (1) Connect your Pinterest account via secure OAuth 2.0, (2) Upload pins via CSV or create them individually, and (3) Pin Desk\'s background workers automatically publish your pins at the right pace — even when your browser is closed.',
  },
  {
    question: 'Is Pin Desk using the official Pinterest API?',
    answer:
      'Yes, Pin Desk uses the official Pinterest API v5 with proper OAuth 2.0 authentication. We never ask for your Pinterest password. Your connection is secure and compliant with Pinterest\'s terms of service.',
  },
  {
    question: 'Can I bulk schedule Pinterest Pins?',
    answer:
      'Yes, bulk scheduling is Pin Desk\'s core feature. You can upload CSV files with thousands of pins (title, description, image URL, link, board) and Pin Desk will validate the data and schedule them with automatic pacing.',
  },
  {
    question: 'Is Pin Desk safe to use?',
    answer:
      'Yes. Pin Desk connects via the official Pinterest API with secure OAuth. All tokens are encrypted at rest. Each connected account is fully isolated. Auto-pacing prevents spam-like behavior. Failed pins are retried with exponential backoff to protect your account health.',
  },
  {
    question: 'Who is Pin Desk for?',
    answer:
      'Pin Desk is built for Pinterest content creators, affiliate marketers, social media agencies, e-commerce businesses, and anyone who needs to publish Pinterest pins at scale. Whether you have 1 board or 100 accounts, Pin Desk has a plan for you.',
  },
  {
    question: 'Does Pin Desk support multiple Pinterest accounts?',
    answer:
      'Yes, Pin Desk supports multiple Pinterest accounts with complete data isolation. Free: 1 account, Pro: 10 accounts, Agency: 100 accounts. Each account has its own boards, scheduling, and publishing logs.',
  },
  {
    question: 'What is auto-pacing and how does it work?',
    answer:
      'Auto-pacing is Pin Desk\'s intelligent publishing feature that distributes your scheduled pins across days to maintain a natural, human-like publishing pattern. This prevents your account from being flagged for spam and keeps your publishing consistent.',
  },
  {
    question: 'Does Pin Desk publish pins when I close my browser?',
    answer:
      'Yes. Pin Desk uses server-side background workers to publish your pins. Once you schedule pins, they will be published automatically on time — even if your browser is closed, your computer is off, or you are asleep.',
  },
  {
    question: 'What happens if a pin fails to publish?',
    answer:
      'Failed pins are automatically retried up to 3 times with exponential backoff. You can also manually retry any failed pin from the logs section. Detailed error messages help you identify and fix issues quickly.',
  },
  {
    question: 'How much does Pin Desk cost?',
    answer:
      'Pin Desk offers three plans: Free ($0/mo — 1 account, 150 pins), Pro ($49/mo — 10 accounts, 75,000 pins), and Agency ($499/mo — 100 accounts, 1,500,000 pins). All plans include core scheduling features, board creation & sync, and Pinterest organic analytics. Upgrade or downgrade anytime.',
  },
  {
    question: 'What payment methods do you accept?',
    answer:
      'Pin Desk currently accepts USDT (TRC20) cryptocurrency for plan upgrades. Submit your transaction ID and our team will verify and activate your plan within 24 hours. Contact support@pindesk.xyz for assistance.',
  },
  {
    question: 'Can I upgrade or downgrade my plan?',
    answer:
      'Yes, you can upgrade or downgrade your plan at any time. Contact our support team or submit a new payment order for the desired plan. Changes take effect immediately after verification.',
  },
  {
    question: 'Do I need to provide my Pinterest password?',
    answer:
      'No. Pin Desk connects via the official Pinterest OAuth 2.0 flow. You authorize Pin Desk through Pinterest\'s own authentication page. We never see or store your Pinterest password.',
  },
  {
    question: 'How do I get started with Pin Desk?',
    answer:
      'Getting started is simple: (1) Create a free account at pindesk.xyz, (2) Connect your Pinterest account via secure OAuth, (3) Start creating or uploading pins. The free plan lets you try everything with 1 account and 150 pins per month.',
  },
]

function FAQ() {
  return (
    <section id="faq" className="bg-muted/40 py-14 sm:py-20 lg:py-28" aria-labelledby="faq-heading">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="text-center">
          <h2 id="faq-heading" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Frequently Asked Questions
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:mt-4 sm:text-lg">
            Everything you need to know about Pin Desk — the Pinterest bulk scheduling tool.
          </p>
        </FadeIn>

        <FadeIn delay={0.15} className="mt-12">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </FadeIn>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  FINAL CTA                                                         */
/* ================================================================== */
function FinalCta() {
  const { setShowSignupModal } = useAppStore()

  return (
    <section className="bg-gradient-to-br from-pin-600 to-rose-500 py-16 sm:py-24 lg:py-28" aria-labelledby="final-cta-heading">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <FadeIn>
          <h2 id="final-cta-heading" className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-5xl">
            Ready to Scale Your Pinterest Strategy?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-white/90 sm:mt-6 sm:text-lg">
            Join hundreds of creators and agencies who use Pin Desk to bulk schedule Pinterest pins. Start free — no credit card required.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:mt-10 sm:flex-row sm:gap-4">
            <Button
              size="lg"
              className="w-full gap-2 bg-white px-6 text-base text-pin-700 hover:bg-white/90 active:bg-white/80 sm:w-auto sm:px-8"
              onClick={() => setShowSignupModal(true)}
            >
              Try Pin Desk Now
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full gap-2 border-2 border-white/80 bg-white/15 px-6 text-base text-white backdrop-blur-sm hover:bg-white/25 hover:border-white active:bg-white/30 sm:w-auto sm:px-8"
              onClick={() => {
                document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              View Pricing
            </Button>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  FOOTER                                                            */
/* ================================================================== */
function Footer() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <a href="/" className="flex items-center gap-2" aria-label="Pin Desk Home">
              <Pin className="size-5 text-pin-600" aria-hidden="true" />
              <span className="text-lg font-bold">Pin Desk</span>
            </a>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              The most reliable way to bulk schedule and publish Pinterest pins using the official Pinterest API. Built for creators, marketers, and agencies.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Use our free tools:</span>
              <a
                href="https://freekit.online"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-pin-600 hover:underline"
              >
                freekit.online
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-sm font-semibold">Quick Links</h4>
            <ul className="mt-3 space-y-1">
              <li>
                <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="min-h-[36px] w-full text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
                  Home
                </button>
              </li>
              <li>
                <button onClick={() => scrollTo('features')} className="min-h-[36px] w-full text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
                  Features
                </button>
              </li>
              <li>
                <button onClick={() => scrollTo('pricing')} className="min-h-[36px] w-full text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
                  Pricing
                </button>
              </li>
              <li>
                <button onClick={() => scrollTo('faq')} className="min-h-[36px] w-full text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
                  FAQ
                </button>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold">Legal</h4>
            <ul className="mt-3 space-y-1">
              <li>
                <a href="/privacy" className="min-h-[36px] flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="/terms" className="min-h-[36px] flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground">
                  Terms & Conditions
                </a>
              </li>
              <li>
                <a href="/about" className="min-h-[36px] flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground">
                  About Us
                </a>
              </li>
              <li>
                <a href="/contact" className="min-h-[36px] flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground">
                  Contact Us
                </a>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-sm font-semibold">Support</h4>
            <ul className="mt-3 space-y-1">
              <li>
                <a
                  href="mailto:support@pindesk.xyz"
                  className="min-h-[36px] flex items-center break-all text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  support@pindesk.xyz
                </a>
              </li>
              <li>
                <a
                  href="https://t.me/AaruViestaa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Send className="size-3.5" aria-hidden="true" />
                  Telegram Support
                </a>
              </li>
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              Usually responds within 24 hours.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t pt-6 text-center sm:mt-10 sm:flex-row sm:text-left">
          <p className="text-xs text-muted-foreground">
            &copy; 2026 Pin Desk. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">
            Developed by{' '}
            <a
              href="https://www.linkedin.com/in/ifaisalh/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground hover:text-pin-600 transition-colors"
            >
              Faisal Hossain
            </a>
 </p>
          <p className="text-xs text-muted-foreground">
            <a href="https://pindesk.xyz" className="hover:text-foreground transition-colors">pindesk.xyz</a>
          </p>
        </div>
      </div>
    </footer>
  )
}

/* ================================================================== */
/*  LANDING PAGE (exported)                                           */
/* ================================================================== */
export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <WhatIsPinDeskSection />
        <Features />
        <Benefits />
        <HowItWorks />
        <UseCases />
        <Pricing />
        <Testimonials />
        <FAQ />
        <FinalCta />
      </main>
      <Footer />
      <TelegramButton />
    </div>
  )
}
