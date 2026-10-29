'use client'

import { useEffect } from 'react'
import { useAppStore, type UserSession } from '@/store'
import { apiFetch, saveSession, loadSession, clearSession } from '@/lib/api'
import { LandingPage } from '@/components/landing'
import { AuthForms } from '@/components/auth-forms'
import { Dashboard } from '@/components/dashboard'
import { AdminPanel } from '@/components/admin-panel'

const ADMIN_TABS = ['overview', 'users', 'payments', 'plans', 'audit-logs']

export function HomeClient() {
  const { user, setUser, view, setView, setDashboardTab, setAdminTab } = useAppStore()

  useEffect(() => {
    // Decide which view to restore after a page load / refresh.
    // The URL hash is the source of truth: #tab=<dashboard-tab> means the
    // user was in the dashboard, #admin=<admin-tab> means the admin panel.
    // Without this, every refresh kicked admins back to the admin panel and
    // regular users back to the Overview tab (reload bug).
    const applySession = (u: UserSession) => {
      setUser(u)
      const isAdmin = u.role === 'admin' || u.role === 'super_admin'
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const hashTab = params.get('tab')
      const hashAdmin = params.get('admin')

      if (isAdmin && hashAdmin && ADMIN_TABS.includes(hashAdmin)) {
        setView('admin')
        setAdminTab(hashAdmin as 'overview')
      } else if (hashTab) {
        // Was viewing the user dashboard (admins can visit it too).
        // The Dashboard component restores the exact tab from the hash.
        setView('dashboard')
      } else if (isAdmin) {
        setView('admin')
        setAdminTab('overview')
      } else {
        setView('dashboard')
        // No hash → default tab; if a hash DOES exist the Dashboard will
        // restore it on mount, so don't force 'overview' here.
        if (!window.location.hash) setDashboardTab('overview')
      }
    }

    const cached = loadSession()
    if (cached) applySession(cached)

    apiFetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          const u = data.user as UserSession
          saveSession(u, data.token)
          applySession(u)
        } else {
          clearSession()
          setUser(null)
          setView('landing')
          // Clear any stale tab hash on logout
          if (window.location.hash) window.history.replaceState({}, '', '/')
        }
      })
      .catch(() => {})
  }, [setUser, setView, setDashboardTab, setAdminTab])

  return (
    <div className="min-h-screen bg-background">
      {view === 'landing' && !user && <LandingPage />}
      {view === 'dashboard' && user && <Dashboard />}
      {view === 'admin' && user && <AdminPanel />}
      <AuthForms />
    </div>
  )
}
