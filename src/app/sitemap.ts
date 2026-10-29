import type { MetadataRoute } from 'next'

const SITE_URL = 'https://pindesk.xyz'
const now = new Date()

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    // Homepage — highest priority, fresh content
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    // Core landing pages — high priority
    {
      url: `${SITE_URL}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/contact`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    // Legal pages — lower priority but important for trust/E-E-A-T
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]
}
