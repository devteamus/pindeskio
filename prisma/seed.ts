import { PrismaClient } from '@prisma/client'
import { hashSync } from 'bcryptjs'

const prisma = new PrismaClient()

async function seed() {
  // ── Create Plans ──
  // Free plan: restrictive limits to encourage paid upgrades.
  // Allows testing both single pin and small bulk uploads, but caps usage
  // so power users need Pro/Agency for real work.
  //   - 1 connected account
  //   - 150 pins/month
  //   - 5 pins/day/account
  //   - 100 rows/import (enough to test bulk upload, not enough for production)
  // NOTE: the `update` block must include EVERY user-facing field (features,
  // maxRowsPerImport, priceUsd, …) — otherwise plan changes in this file never
  // reach an existing database and the dashboard keeps showing stale plans.
  const freePlan = await prisma.plan.upsert({
    where: { id: 'plan_free' },
    update: {
      name: 'Free',
      maxConnectedAccounts: 1,
      monthlyPinQuota: 150,
      dailyPinLimit: 5,
      maxRowsPerImport: 100,
      priceUsd: 0,
      features: JSON.stringify(['Single pin create', 'Bulk CSV upload', '1 connected account', '150 pins/month', '5 pins/day/account', 'Create boards & board sync', 'Community support']),
    },
    create: {
      id: 'plan_free',
      name: 'Free',
      maxConnectedAccounts: 1,
      monthlyPinQuota: 150,
      dailyPinLimit: 5,
      maxRowsPerImport: 100,
      priceUsd: 0,
      features: JSON.stringify(['Single pin create', 'Bulk CSV upload', '1 connected account', '150 pins/month', '5 pins/day/account', 'Create boards & board sync', 'Community support']),
    },
  })

  const proPlan = await prisma.plan.upsert({
    where: { id: 'plan_pro' },
    update: {
      name: 'Pro',
      maxConnectedAccounts: 10,
      monthlyPinQuota: 75000,
      dailyPinLimit: 250,
      maxRowsPerImport: 10000,
      priceUsd: 49,
      features: JSON.stringify(['Bulk CSV schedule', '10 connected accounts', '75,000 pins/month', '250 pins/day/account', 'Background publishing', 'Create boards & live board sync', 'Pinterest organic analytics', 'Retry logs', 'Priority support', 'Account switcher']),
    },
    create: {
      id: 'plan_pro',
      name: 'Pro',
      maxConnectedAccounts: 10,
      monthlyPinQuota: 75000,
      dailyPinLimit: 250,
      maxRowsPerImport: 10000,
      priceUsd: 49,
      features: JSON.stringify(['Bulk CSV schedule', '10 connected accounts', '75,000 pins/month', '250 pins/day/account', 'Background publishing', 'Create boards & live board sync', 'Pinterest organic analytics', 'Retry logs', 'Priority support', 'Account switcher']),
    },
  })

  const agencyPlan = await prisma.plan.upsert({
    where: { id: 'plan_agency' },
    update: {
      name: 'Agency',
      maxConnectedAccounts: 100,
      monthlyPinQuota: 1500000,
      dailyPinLimit: 500,
      maxRowsPerImport: 50000,
      priceUsd: 499,
      features: JSON.stringify(['Everything in Pro', '100 connected accounts', '1,500,000 pins/month', '500 pins/day/account', 'Board manager & live sync', 'Advanced organic analytics', 'Team-ready operations', 'Advanced logs', 'Higher concurrency', 'Admin-assisted support']),
    },
    create: {
      id: 'plan_agency',
      name: 'Agency',
      maxConnectedAccounts: 100,
      monthlyPinQuota: 1500000,
      dailyPinLimit: 500,
      maxRowsPerImport: 50000,
      priceUsd: 499,
      features: JSON.stringify(['Everything in Pro', '100 connected accounts', '1,500,000 pins/month', '500 pins/day/account', 'Board manager & live sync', 'Advanced organic analytics', 'Team-ready operations', 'Advanced logs', 'Higher concurrency', 'Admin-assisted support']),
    },
  })

  console.log('Plans seeded:', [freePlan.id, proPlan.id, agencyPlan.id])

  // ── Create Admin User (from env vars) ──
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD

  if (adminEmail && adminPassword) {
    const adminPasswordHash = hashSync(adminPassword, 10)
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        name: 'Admin',
        passwordHash: adminPasswordHash,
        role: 'super_admin',
        status: 'active',
        currentPlanId: agencyPlan.id,
        approvedAt: new Date(),
      },
    })
    console.log('Admin user seeded:', admin.email)
  } else {
    console.warn('ADMIN_EMAIL and/or ADMIN_PASSWORD not set — skipping admin seed. Set them in .env to create the admin user.')
  }

  console.log('Seed completed successfully')
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
