import type { MetadataRoute } from 'next'

const SITE_URL = 'https://pindesk.xyz'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/dashboard',
          '/admin',
        ],
      },
      // Explicitly allow good bots to crawl everything except API/auth routes
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/api/', '/dashboard', '/admin'],
      },
      {
        userAgent: 'Bingbot',
        allow: '/',
        disallow: ['/api/', '/dashboard', '/admin'],
      },
      // Block AI training bots that don't benefit our SEO (optional — keep GPT/Claude/Gemini allowed)
      {
        userAgent: 'GPTBot',
        allow: '/',
      },
      {
        userAgent: 'ClaudeBot',
        allow: '/',
      },
      {
        userAgent: 'Google-Extended',
        allow: '/',
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/',
      },
      // Block common scrapers that don't provide value
      {
        userAgent: 'SemrushBot',
        allow: '/',
        crawlDelay: 10,
      },
      {
        userAgent: 'AhrefsBot',
        allow: '/',
        crawlDelay: 10,
      },
    ],
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
    ],
    host: SITE_URL,
  }
}
