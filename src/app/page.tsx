import type { Metadata } from 'next'
import { HomeClient } from '@/components/home-client'

/* ------------------------------------------------------------------ */
/*  SEO Metadata — optimized for Google, Bing, ChatGPT, Gemini, etc.  */
/*  Target keywords: Pinterest bulk pin scheduler, schedule Pinterest  */
/*  pins, Pinterest automation, Pinterest bulk upload                  */
/* ------------------------------------------------------------------ */
const SITE_URL = 'https://pindesk.xyz'
const SITE_NAME = 'Pin Desk'
const SITE_TAGLINE = 'Bulk Pinterest Pin Scheduler — Schedule Unlimited Pins'
const SITE_DESCRIPTION =
  'Pin Desk is the #1 Pinterest bulk pin scheduler that uses the official Pinterest API. Schedule and publish unlimited Pinterest pins in bulk — upload CSV files, auto-pace publishing across days, manage multiple Pinterest accounts, and publish thousands of pins on autopilot. Trusted by creators, marketers, agencies, and e-commerce businesses worldwide. Free plan available — no credit card required.'

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'Pinterest bulk pin scheduler',
    'bulk schedule Pinterest pins',
    'Pinterest scheduler',
    'Pinterest automation tool',
    'Pinterest bulk upload',
    'schedule Pinterest pins',
    'Pinterest auto poster',
    'Pinterest pin scheduler free',
    'Pinterest CSV bulk upload',
    'Pinterest marketing automation',
    'Pinterest scheduling tool',
    'Pinterest bulk posting',
    'auto publish Pinterest pins',
    'Pinterest content scheduler',
    'Pinterest API scheduler',
    'Pinterest business scheduler',
    'Pinterest affiliate marketing tool',
    'Pinterest creator scheduler',
    'Pinterest agency tool',
    'unlimited Pinterest pins',
    'Pinterest drip feed tool',
    'Pinterest pin queue',
    'Pinterest pacing tool',
    'how to schedule Pinterest pins in bulk',
    'best Pinterest scheduling tool 2025',
    'Pinterest scheduler without limits',
    'Tailwind alternative Pinterest',
    'Buffer alternative Pinterest',
    'cheapest Pinterest scheduler',
    'Pinterest spam safe scheduler',
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description:
      'Schedule unlimited Pinterest pins in bulk. Upload CSV, auto-pace publishing, manage multiple accounts. Uses official Pinterest API — safe & compliant. Free plan available. Start scheduling in 2 minutes.',
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — Bulk Pinterest Pin Scheduler`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@pindesk',
    creator: '@pindesk',
    title: `${SITE_NAME} — Bulk Pinterest Pin Scheduler`,
    description:
      'Schedule unlimited Pinterest pins in bulk. Official Pinterest API. CSV upload, auto-pacing, multi-account. Free plan available — no credit card required.',
    images: [`${SITE_URL}/og-image.png`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  category: 'Marketing Software',
  classification: 'Pinterest Marketing, Social Media Scheduling, Content Automation',
}

/* ------------------------------------------------------------------ */
/*  JSON-LD Structured Data                                           */
/*  Multiple schemas for maximum AEO/GEO visibility                   */
/* ------------------------------------------------------------------ */
function JsonLd() {
  // 1. SoftwareApplication — for rich results in Google
  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Pin Desk',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Social Media Scheduling',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript. Requires HTML5.',
    description:
      'Pin Desk is a Pinterest bulk pin scheduling SaaS that helps creators, marketers, and agencies schedule and publish unlimited Pinterest pins in bulk using the official Pinterest API v5. Features include CSV bulk upload, auto-pacing, multi-account management, and background publishing.',
    url: SITE_URL,
    screenshot: `${SITE_URL}/og-image.png`,
    featureList: [
      'Bulk schedule Pinterest pins via CSV upload',
      'Auto-pacing to distribute pins across days',
      'Multi-account Pinterest management',
      'Background publishing — no browser needed',
      'Official Pinterest API v5 integration',
      'Automatic retry for failed pins',
      'Pause, resume, and cancel scheduled batches',
      'Real-time publishing status dashboard',
      'Monthly and daily pin quota management',
      'USDT (TRC20) and Binance Pay payment options',
    ],
    offers: [
      {
        '@type': 'Offer',
        name: 'Free',
        price: '0',
        priceCurrency: 'USD',
        description: '1 Pinterest account, 150 pins/month, 5 pins/day, 100 rows/import',
        url: `${SITE_URL}#pricing`,
      },
      {
        '@type': 'Offer',
        name: 'Pro',
        price: '49',
        priceCurrency: 'USD',
        description: '10 Pinterest accounts, 75,000 pins/month, 250 pins/day per account, 10,000 rows/import',
        url: `${SITE_URL}#pricing`,
      },
      {
        '@type': 'Offer',
        name: 'Agency',
        price: '499',
        priceCurrency: 'USD',
        description: '100 Pinterest accounts, 1,500,000 pins/month, 500 pins/day per account, 50,000 rows/import',
        url: `${SITE_URL}#pricing`,
      },
    ],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '127',
      bestRating: '5',
      worstRating: '1',
      reviewCount: '127',
    },
  }

  // 2. Organization — for knowledge panel
  const orgSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Pin Desk',
    legalName: 'Pin Desk',
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    description:
      'Pin Desk is a Pinterest marketing automation SaaS that helps creators, marketers, agencies, and businesses schedule and publish Pinterest pins in bulk.',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'support@pindesk.xyz',
      contactType: 'customer support',
      availableLanguage: ['English'],
    },
    sameAs: ['https://t.me/AaruViestaa'],
    knowsAbout: [
      'Pinterest Marketing',
      'Pinterest Scheduling',
      'Pinterest Automation',
      'Social Media Management',
      'Content Marketing',
      'Affiliate Marketing',
      'Pinterest API v5',
      'Bulk Pin Scheduling',
    ],
  }

  // 3. WebSite — enables sitelinks search box
  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Pin Desk',
    alternateName: 'Pinterest Bulk Pin Scheduler',
    url: SITE_URL,
    description:
      'Bulk schedule Pinterest pins with the official Pinterest API. Multi-account management, CSV upload, auto-pacing publishing.',
    inLanguage: 'en',
    publisher: {
      '@type': 'Organization',
      name: 'Pin Desk',
      url: SITE_URL,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }

  // 4. WebPage — homepage
  const webpageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Pin Desk',
      url: SITE_URL,
    },
    about: {
      '@type': 'Thing',
      name: 'Pinterest Bulk Pin Scheduling',
      description: 'Scheduling and publishing Pinterest pins in bulk using the official Pinterest API',
    },
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/og-image.png`,
    },
  }

  // 5. BreadcrumbList
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Pinterest Scheduler',
        item: `${SITE_URL}#features`,
      },
    ],
  }

  // 6. HowTo — for "How to schedule Pinterest pins" rich results
  const howToSchema = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How to Bulk Schedule Pinterest Pins with Pin Desk',
    description:
      'Learn how to schedule and publish unlimited Pinterest pins in bulk using Pin Desk and the official Pinterest API.',
    totalTime: 'PT2M',
    estimatedCost: {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: '0',
    },
    supply: [
      {
        '@type': 'HowToSupply',
        name: 'Pinterest business account',
      },
      {
        '@type': 'HowToSupply',
        name: 'CSV file with pin data (title, image_url, board_name)',
      },
    ],
    tool: [
      {
        '@type': 'HowToTool',
        name: 'Pin Desk account (free or paid)',
      },
    ],
    step: [
      {
        '@type': 'HowToStep',
        position: 1,
        name: 'Create a free Pin Desk account',
        text: 'Sign up for a free Pin Desk account at pindesk.xyz. No credit card required — you get 150 pins/month free.',
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: 'Connect your Pinterest account',
        text: 'Click "Connect New Account" and authorize Pin Desk via Pinterest OAuth. This uses the official Pinterest API v5 — completely safe and compliant with Pinterest terms.',
      },
      {
        '@type': 'HowToStep',
        position: 3,
        name: 'Sync your Pinterest boards',
        text: 'Click "Sync" to import your Pinterest boards into Pin Desk. This lets you select the correct board when scheduling pins.',
      },
      {
        '@type': 'HowToStep',
        position: 4,
        name: 'Create a CSV file with your pins',
        text: 'Create a CSV file with columns: title, board_name, image_url, destination_url, description, alt_text. Each row becomes one scheduled pin.',
      },
      {
        '@type': 'HowToStep',
        position: 5,
        name: 'Upload the CSV to Pin Desk',
        text: 'Go to the Bulk Upload tab, select your connection, choose the CSV file, and select "Auto Pacing" mode. Pin Desk automatically calculates the optimal interval between pins.',
      },
      {
        '@type': 'HowToStep',
        position: 6,
        name: 'Set your daily target',
        text: 'Choose how many pins to publish per day. Pin Desk will space them evenly — e.g. 1000 pins/day = 1 pin every 1.44 minutes. This prevents spam detection.',
      },
      {
        '@type': 'HowToStep',
        position: 7,
        name: 'Click Upload & Schedule',
        text: 'Pin Desk validates each row, creates scheduled pins, and starts publishing them automatically using background workers — even when your browser is closed.',
      },
      {
        '@type': 'HowToStep',
        position: 8,
        name: 'Monitor and manage',
        text: 'View live publishing status in the Recent Imports section. Pause, resume, or cancel batches anytime. Detailed logs show every published and failed pin.',
      },
    ],
  }

  // 7. FAQPage — for FAQ rich results (expanded with high-intent questions)
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is Pin Desk?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Pin Desk is a Pinterest bulk pin scheduling SaaS platform that allows creators, marketers, agencies, and businesses to schedule and publish unlimited Pinterest pins in bulk using the official Pinterest API v5. It supports multi-account management, CSV bulk upload, auto-pacing, and background publishing — so your pins get published even when your browser is closed.',
        },
      },
      {
        '@type': 'Question',
        name: 'How does Pin Desk work?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Pin Desk works in three simple steps: (1) Connect your Pinterest account via secure OAuth, (2) Upload pins via CSV or create them individually, (3) Pin Desk\'s background workers publish your pins at the right pace automatically. You can close your browser and your pins will still be published on schedule.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is Pin Desk using the official Pinterest API?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, Pin Desk uses the official Pinterest API v5 with proper OAuth 2.0 authentication. Your account remains safe and compliant with Pinterest\'s terms of service. We never ask for your Pinterest password — only OAuth authorization.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I bulk schedule Pinterest pins?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes — bulk scheduling is Pin Desk\'s main feature. You can upload CSV files with up to 50,000 pins (Agency plan) and Pin Desk will automatically pace and publish them according to your daily targets. Auto-pacing distributes pins evenly across 24 hours to prevent spam detection.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is Pin Desk safe to use with my Pinterest account?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, Pin Desk is 100% safe. It uses the official Pinterest API with secure OAuth 2.0 authentication, encrypts all access tokens at rest, isolates each connected account completely, and uses auto-pacing to maintain a natural, human-like publishing pattern. This prevents spam detection and keeps your Pinterest account in good standing.',
        },
      },
      {
        '@type': 'Question',
        name: 'Who is Pin Desk for?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Pin Desk is built for Pinterest content creators, affiliate marketers, social media agencies, e-commerce businesses, bloggers, and anyone who needs to publish Pinterest pins at scale. Whether you schedule 10 pins or 10,000 pins per month, Pin Desk has a plan for you.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does Pin Desk support multiple Pinterest accounts?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, Pin Desk supports multiple Pinterest accounts with complete data isolation. The Free plan includes 1 account, Pro includes 10 accounts, and Agency includes up to 100 accounts. Each account has its own boards, scheduled pins, and quota — completely separate from each other.',
        },
      },
      {
        '@type': 'Question',
        name: 'What is auto-pacing in Pin Desk?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Auto-pacing is Pin Desk\'s feature that automatically distributes your scheduled pins across the day or month to maintain a natural, human-like publishing pattern. For example, if you schedule 1000 pins with a daily target of 1000, Pin Desk will publish one pin every 1.44 minutes — all within 24 hours. This prevents spam detection and keeps your account safe.',
        },
      },
      {
        '@type': 'Question',
        name: 'How much does Pin Desk cost?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Pin Desk offers three plans: Free ($0/mo, 1 account, 150 pins/month, 5 pins/day), Pro ($49/mo, 10 accounts, 75,000 pins/month, 250 pins/day per account), and Agency ($499/mo, 100 accounts, 1,500,000 pins/month, 500 pins/day per account). All plans include core scheduling features, CSV upload, and auto-pacing.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does Pin Desk publish pins when I close my browser?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, Pin Desk uses server-side background workers to publish your pins. Once scheduled, your pins will be published automatically even when your browser is closed, your device is off, or you\'re sleeping. This is the main advantage of Pin Desk over browser-based schedulers.',
        },
      },
      {
        '@type': 'Question',
        name: 'What happens if a pin fails to publish?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Failed pins are automatically retried up to 3 times with exponential backoff (5s, 15s, 45s delays). You can also manually retry any failed pin from the Logs section. Detailed error messages help you identify and fix issues — common causes are invalid image URLs, deleted boards, or expired OAuth tokens.',
        },
      },
      {
        '@type': 'Question',
        name: 'What payment methods does Pin Desk accept?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Pin Desk currently accepts USDT (TRC20) cryptocurrency and Binance Pay for plan upgrades. TRC20 payments are auto-verified on the blockchain within seconds — no manual waiting. Binance Pay payments are manually verified within 24 hours.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I schedule unlimited Pinterest pins?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, with the Agency plan ($499/mo) you can schedule up to 1,500,000 pins per month — effectively unlimited for most users. The Pro plan ($49/mo) allows 75,000 pins/month, and the Free plan allows 150 pins/month for testing.',
        },
      },
      {
        '@type': 'Question',
        name: 'How is Pin Desk different from Tailwind or Buffer?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Pin Desk is purpose-built for Pinterest bulk scheduling with the official Pinterest API. Unlike Tailwind or Buffer which are general-purpose social media tools, Pin Desk specializes in high-volume Pinterest publishing — supporting up to 50,000 pins per import, multi-account management, CSV bulk upload, and auto-pacing. Plus, Pin Desk is significantly cheaper for high-volume users.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need a Pinterest business account?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, you need a Pinterest business account (free to create) to use Pin Desk. The official Pinterest API requires business account access. If you have a personal Pinterest account, you can convert it to a business account for free in your Pinterest settings.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I cancel my subscription anytime?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, you can cancel your subscription anytime. There are no long-term contracts or cancellation fees. Once cancelled, your plan remains active until the end of your billing period (30 days from payment), after which your account reverts to the Free plan.',
        },
      },
    ],
  }

  // 8. Service schema
  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Pinterest Bulk Pin Scheduling',
    serviceType: 'Social Media Scheduling',
    provider: {
      '@type': 'Organization',
      name: 'Pin Desk',
      url: SITE_URL,
    },
    areaServed: 'Worldwide',
    description:
      'Bulk schedule and publish Pinterest pins using the official Pinterest API. Upload CSV files, auto-pace publishing, manage multiple accounts.',
    offers: {
      '@type': 'AggregateOffer',
      lowPrice: '0',
      highPrice: '499',
      priceCurrency: 'USD',
      offerCount: '3',
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webpageSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Page — Server Component                                            */
/* ------------------------------------------------------------------ */
export default function Page() {
  return (
    <>
      <JsonLd />
      <HomeClient />
    </>
  )
}
