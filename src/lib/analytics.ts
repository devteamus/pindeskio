// ─── Google Analytics 4 Measurement Protocol ───────────────────────
// Server-side event tracking for revenue + conversion tracking.
// More reliable than client-side gtag() because it fires directly when
// payment is verified — no dependency on browser being open.
//
// Setup:
// 1. GA4 Measurement ID: G-J2KE00E1FY (already in layout.tsx)
// 2. GA4 API Secret: set GA4_API_SECRET env var in Coolify
//    (Get it from GA4 Admin → Data Streams → your stream → Measurement Protocol API secret)
// 3. GA4 Measurement Protocol automatically tracks: purchase events, revenue, plan upgrades

const GA4_MEASUREMENT_ID = 'G-J2KE00E1FY'
const GA4_API_SECRET = process.env.GA4_API_SECRET || ''

interface GA4Event {
  name: string
  params: Record<string, unknown>
}

interface GA4User {
  userId?: string
  email?: string
}

/**
 * Send an event to GA4 via Measurement Protocol (server-side).
 * Requires GA4_API_SECRET env var. If not set, silently skips (no error).
 *
 * @param event - Event name + parameters
 * @param user - Optional user info for user identification
 * @returns true if sent, false if skipped/failed
 */
export async function trackGA4Event(
  event: GA4Event,
  user?: GA4User,
): Promise<boolean> {
  // Skip if API secret not configured (don't break the app)
  if (!GA4_API_SECRET) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[GA4] Skipping event — GA4_API_SECRET not set:', event.name)
    }
    return false
  }

  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`

    const payload = {
      client_id: user?.userId || 'server-side',
      user_id: user?.userId,
      user_properties: user?.email ? {
        email: { value: user.email },
      } : undefined,
      events: [
        {
          name: event.name,
          params: {
            // GA4 requires engagement_time_msec for events to show up in real-time
            engagement_time_msec: 100,
            ...event.params,
          },
        },
      ],
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      console.error('[GA4] Event failed:', res.status, await res.text())
      return false
    }

    return true
  } catch (err: any) {
    // Don't let GA4 failure break payment verification
    console.error('[GA4] Event crashed:', err.message)
    return false
  }
}

/**
 * Track a purchase event when payment is verified.
 * This shows up in GA4 Reports → Monetization → Ecommerce purchases.
 *
 * @param orderId - Payment order ID
 * @param userId - User who paid
 * @param planName - Plan name (Pro, Agency)
 * @param amount - Amount in USD
 * @param userEmail - User's email for user identification
 */
export async function trackPaymentVerified(params: {
  orderId: string
  userId: string
  planName: string
  amount: number
  userEmail?: string
}): Promise<void> {
  await trackGA4Event(
    {
      name: 'purchase',
      params: {
        transaction_id: params.orderId,
        value: params.amount,
        currency: 'USD',
        items: [
          {
            item_id: params.planName.toLowerCase(),
            item_name: `${params.planName} Plan`,
            item_category: 'subscription',
            price: params.amount,
            quantity: 1,
          },
        ],
        // Custom parameters for better reporting
        plan_name: params.planName,
        payment_method: 'crypto_usdt_trc20',
      },
    },
    { userId: params.userId, email: params.userEmail },
  )
}

/**
 * Track plan upgrade event (separate from purchase for funnel analysis).
 */
export async function trackPlanUpgraded(params: {
  userId: string
  fromPlan: string
  toPlan: string
  amount: number
}): Promise<void> {
  await trackGA4Event(
    {
      name: 'plan_upgrade',
      params: {
        from_plan: params.fromPlan,
        to_plan: params.toPlan,
        value: params.amount,
        currency: 'USD',
      },
    },
    { userId: params.userId },
  )
}

/**
 * Track user signup event.
 */
export async function trackUserSignup(userId: string, email?: string): Promise<void> {
  await trackGA4Event(
    {
      name: 'sign_up',
      params: {
        method: 'email',
      },
    },
    { userId, email },
  )
}

/**
 * Track bulk upload event.
 */
export async function trackBulkUpload(params: {
  userId: string
  rowCount: number
  validRows: number
  connectionId: string
}): Promise<void> {
  await trackGA4Event(
    {
      name: 'bulk_upload',
      params: {
        row_count: params.rowCount,
        valid_rows: params.validRows,
      },
    },
    { userId: params.userId },
  )
}

/**
 * Track pin published event.
 */
export async function trackPinPublished(params: {
  userId: string
  connectionId: string
  batchId?: string
}): Promise<void> {
  await trackGA4Event(
    {
      name: 'pin_published',
      params: {
        connection_id: params.connectionId,
        batch_id: params.batchId,
      },
    },
    { userId: params.userId },
  )
}
