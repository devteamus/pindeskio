import type { NextConfig } from "next";

// ─── Security headers (second-pass audit) ───────────────────────────
// Baseline hardening headers applied to every response. CSP is shipped in
// Report-Only first: it observes violations in real traffic without
// breaking anything; once the console shows zero violations, drop the
// "-Report-Only" suffix to enforce.
//
// NOTE: this app uses NO next/image (no <Image> imports anywhere) and the
// Next.js Image Optimization API had unauthenticated-RCE advisories in the
// 16.x line — `images.unoptimized` below removes that endpoint's optimizer
// from the attack surface entirely.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // The public entry point is HTTPS (TLS terminates at the reverse proxy —
  // Coolify/Traefik — which is the only listener); instruct browsers to
  // stay on HTTPS for a year.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.resend.com https://www.google-analytics.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Second-pass audit: `npx tsc --noEmit` is clean with the generated
    // Prisma client — type errors now FAIL the build instead of shipping.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  images: {
    // No <Image> usage in this app; removes the /_next/image optimizer
    // (RCE/SSRF advisory surface on the 16.x line) from production.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // HTML documents must NEVER be cached long: a new deploy changes the
        // referenced JS chunks, and a stale cached HTML pointing at deleted
        // chunk files breaks the whole app (blank page / dead buttons) until
        // the user does a hard refresh. Static assets under /_next/static/
        // have hashed filenames and stay immutable — those are safe to cache.
        source: "/((?!_next/static|_next/image|api/|favicon|icon|manifest|robots|sitemap|.*\\..*).*)",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, must-revalidate" },
          ...securityHeaders,
        ],
      },
      {
        // Hashed build assets — safe to cache forever
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ...securityHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
