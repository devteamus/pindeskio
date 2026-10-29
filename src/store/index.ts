import { create } from 'zustand'

export type AppView = 'landing' | 'dashboard' | 'admin'
export type DashboardTab = 'overview' | 'accounts' | 'boards' | 'create-pin' | 'bulk-upload' | 'scheduled' | 'analytics' | 'logs' | 'plan-payment' | 'settings'
export type AdminTab = 'overview' | 'users' | 'payments' | 'plans' | 'audit-logs'

export interface UserSession {
  userId: string
  email: string
  name: string | null
  role: string
  status: string
  currentPlanId: string | null
}

export interface PinterestConnection {
  id: string
  userId: string
  pinterestAccountId: string | null
  profileName: string | null
  profileImageUrl: string | null
  status: string
  lastSyncedAt: string | null
  nickname: string | null
  createdAt: string
  boards: PinterestBoard[]
  _count?: { scheduledPins: number; importBatches: number }
}

export interface PinterestBoard {
  id: string
  connectionId: string
  pinterestBoardId: string
  boardName: string
  boardDescription: string | null
  isActive: boolean
  pinCount: number
  privacy: string
  syncedAt: string
}

export interface Plan {
  id: string
  name: string
  maxConnectedAccounts: number
  monthlyPinQuota: number
  maxRowsPerImport: number
  priceUsd: number | null
  features: string
}

export interface ImportBatch {
  id: string
  userId: string
  connectionId: string
  originalFileName: string | null
  importMode: string
  dailyTarget: number | null
  totalRows: number
  validRows: number
  invalidRows: number
  queuedRows: number
  status: string
  createdAt: string
}

export interface ImportRowDetail {
  id: string
  rowNumber: number
  title: string | null
  imageUrl: string | null
  destinationUrl: string | null
  boardInput: string | null
  publishAt: string | null
  validationStatus: string
  validationErrors: string | null
  resolvedBoard?: { boardName: string } | null
  scheduledPin?: {
    id: string
    scheduledFor: string | null
    status: string
    publishedAt: string | null
    lastError: string | null
    externalPinId: string | null
    attemptCount: number
  } | null
}

export interface ImportBatchWithRows extends ImportBatch {
  connection?: { nickname: string | null; profileName: string | null } | null
  rows?: ImportRowDetail[]
  _count?: { rows: number; scheduledPins: number }
  statusBreakdown?: Record<string, number>
  statusCounts?: Record<string, number>
}

export interface ScheduledPin {
  id: string
  userId: string
  connectionId: string
  batchId: string | null
  title: string | null
  description: string | null
  destinationUrl: string | null
  imageUrl: string | null
  scheduledFor: string | null
  status: string
  attemptCount: number
  lastError: string | null
  externalPinId: string | null
  publishedAt: string | null
  createdAt: string
  board?: { boardName: string }
}

export interface PaymentOrder {
  id: string
  userId: string
  planId: string
  amount: number
  expectedAmount?: number
  network: string
  txid: string | null
  status: string
  createdAt: string
  plan?: { name: string; priceUsd: number | null }
  user?: { email: string; name: string | null }
}

export interface DashboardStats {
  currentPlan: Plan | null
  monthlyQuota: number
  usedPinsThisMonth: number
  remainingPins: number
  connectedAccounts: number
  accountLimit: number
  dailyPinLimit: number
  activeSchedules: number
  failedJobs: number
}

interface AppState {
  user: UserSession | null
  setUser: (user: UserSession | null) => void
  view: AppView
  setView: (view: AppView) => void
  dashboardTab: DashboardTab
  setDashboardTab: (tab: DashboardTab) => void
  adminTab: AdminTab
  setAdminTab: (tab: AdminTab) => void
  showLoginModal: boolean
  setShowLoginModal: (v: boolean) => void
  showSignupModal: boolean
  setShowSignupModal: (v: boolean) => void
  showForgotPasswordModal: boolean
  setShowForgotPasswordModal: (v: boolean) => void
  selectedConnectionId: string | null
  setSelectedConnectionId: (id: string | null) => void
  refreshKey: number
  triggerRefresh: () => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  view: 'landing',
  setView: (view) => set({ view }),
  dashboardTab: 'overview',
  setDashboardTab: (tab) => set({ dashboardTab: tab }),
  adminTab: 'overview',
  setAdminTab: (tab) => set({ adminTab: tab }),
  showLoginModal: false,
  setShowLoginModal: (v) => set({ showLoginModal: v, showSignupModal: false, showForgotPasswordModal: false }),
  showSignupModal: false,
  setShowSignupModal: (v) => set({ showSignupModal: v, showLoginModal: false, showForgotPasswordModal: false }),
  showForgotPasswordModal: false,
  setShowForgotPasswordModal: (v) => set({ showForgotPasswordModal: v, showLoginModal: false, showSignupModal: false }),
  selectedConnectionId: null,
  setSelectedConnectionId: (id) => set({ selectedConnectionId: id }),
  refreshKey: 0,
  triggerRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}))
