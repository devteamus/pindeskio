'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore, type DashboardStats, type DashboardTab, type PinterestConnection, type PinterestBoard, type ScheduledPin, type PaymentOrder, type Plan, type ImportBatchWithRows, type ImportRowDetail } from '@/store'
import { toast } from 'sonner'
import { apiFetch, clearSession } from '@/lib/api'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import {
  LayoutDashboard, Link2, PlusCircle, Upload, Calendar, FileText, CreditCard,
  Shield, LogOut, Menu, ChevronDown, RefreshCw, Trash2, Pencil, Check, X,
  Clock, AlertCircle, CheckCircle2, XCircle, PauseCircle, PlayCircle,
  Copy, ChevronRight, Loader2, FolderSync, ArrowUpDown, LogIn,
  BarChart3, Download, Trophy, LayoutGrid
} from 'lucide-react'

// ─── Nav Items ───────────────────────────────────────────────────────
const NAV_ITEMS = [
  { key: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
  { key: 'accounts' as const, label: 'Accounts', icon: Link2 },
  { key: 'boards' as const, label: 'Boards', icon: LayoutGrid },
  { key: 'create-pin' as const, label: 'Create Pin', icon: PlusCircle },
  { key: 'bulk-upload' as const, label: 'Bulk Upload', icon: Upload },
  { key: 'scheduled' as const, label: 'Scheduled', icon: Calendar },
  { key: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
  { key: 'logs' as const, label: 'Logs', icon: FileText },
  { key: 'plan-payment' as const, label: 'Plan & Payment', icon: CreditCard },
]

const TAB_TITLES: Record<string, string> = {
  overview: 'Overview',
  accounts: 'Pinterest Accounts',
  boards: 'Boards',
  'create-pin': 'Create Pin',
  'bulk-upload': 'Bulk Upload',
  scheduled: 'Scheduled Pins',
  analytics: 'Analytics',
  logs: 'Publishing Logs',
  'plan-payment': 'Plan & Payment',
}

// ─── Status Badge Helper ─────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  let cls = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  if (s === 'published' || s === 'active' || s === 'completed') cls = 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
  else if (s === 'queued' || s === 'pending' || s === 'publishing') cls = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
  else if (s === 'failed' || s === 'failed_final' || s === 'failed_verification') cls = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
  else if (s === 'paused') cls = 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400'
  else if (s === 'canceled' || s === 'cancelled') cls = 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
  else if (s === 'processing') cls = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
  else if (s === 'confirmed') cls = 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
  else if (s === 'verifying') cls = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
  else if (s === 'reauth_required') cls = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
  else if (s === 'retry_waiting') cls = 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400'
  return <Badge variant="secondary" className={cls}>{status}</Badge>
}

// ─── Sidebar Nav Content ─────────────────────────────────────────────
function SidebarNav({ onSelect, activeTab, user, onLogout, onAdmin }: {
  onSelect: (tab: typeof NAV_ITEMS[number]['key']) => void
  activeTab: string
  user: NonNullable<ReturnType<typeof useAppStore.getState>['user']>
  onLogout: () => void
  onAdmin: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-pin-600 text-white font-bold text-sm">P</div>
        <span className="text-lg font-bold tracking-tight">Pin Desk</span>
      </div>
      <Separator />
      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.key
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-pin-100 text-pin-700 dark:bg-pin-900/30 dark:text-pin-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          )
        })}
      </nav>
      <Separator />
      {(user.role === 'admin' || user.role === 'super_admin') && (
        <button
          onClick={onAdmin}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Shield className="size-4" />
          Admin Panel
        </button>
      )}
      <div className="p-3">
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <LogOut className="size-4" />
          Logout
        </button>
      </div>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────
function OverviewTab({ connections }: { connections: PinterestConnection[] }) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      apiFetch('/api/dashboard/stats')
        .then((r) => r.json())
        .then((data) => { if (!cancelled) { setStats(data); setLoading(false) } })
        .catch(() => { if (!cancelled) setLoading(false) })
    }
    load()
    // Auto-refresh every 30s so usage counters, active schedules and failed
    // jobs stay live while the worker publishes pins in the background.
    const t = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(t) }
  }, [refreshKey])

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
        ))}
      </div>
    )
  }

  if (!stats) {
    return <Card className="p-6"><p className="text-muted-foreground">Failed to load stats.</p></Card>
  }

  const quotaPercent = stats.monthlyQuota > 0 ? Math.round((stats.usedPinsThisMonth / stats.monthlyQuota) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Current Plan */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Plan</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {stats.currentPlan?.name || 'Free'}
              <Badge variant="secondary" className="bg-pin-100 text-pin-700 dark:bg-pin-900/40 dark:text-pin-400">Active</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent />
        </Card>

        {/* Monthly Quota */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Monthly Quota</CardDescription>
            <CardTitle className="text-2xl">
              {stats.usedPinsThisMonth} <span className="text-base font-normal text-muted-foreground">/ {stats.monthlyQuota}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={quotaPercent} className="h-2" />
            <p className="mt-1.5 text-xs text-muted-foreground">{stats.remainingPins} remaining</p>
          </CardContent>
        </Card>

        {/* Connected Accounts */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Connected Accounts</CardDescription>
            <CardTitle className="text-2xl">
              {stats.connectedAccounts} <span className="text-base font-normal text-muted-foreground">/ {stats.accountLimit}</span>
            </CardTitle>
          </CardHeader>
          <CardContent />
        </Card>

        {/* Daily Pin Limit */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Daily Limit / Account</CardDescription>
            <CardTitle className="text-2xl">{stats.dailyPinLimit} <span className="text-base font-normal text-muted-foreground">pins / 24h</span></CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Hard limit per connected account</p>
          </CardContent>
        </Card>

        {/* Active Schedules */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Schedules</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Clock className="size-5 text-yellow-500" />
              {stats.activeSchedules}
            </CardTitle>
          </CardHeader>
          <CardContent />
        </Card>

        {/* Failed Jobs */}
        <Card className={stats.failedJobs > 0 ? 'border-red-200 dark:border-red-800' : ''}>
          <CardHeader className="pb-2">
            <CardDescription>Failed Jobs</CardDescription>
            <CardTitle className={`text-2xl flex items-center gap-2 ${stats.failedJobs > 0 ? 'text-red-500' : ''}`}>
              <AlertCircle className={stats.failedJobs > 0 ? 'size-5 text-red-500' : 'size-5 text-muted-foreground'} />
              {stats.failedJobs}
            </CardTitle>
          </CardHeader>
          <CardContent />
        </Card>
      </div>

      {/* Per-Connection Summary */}
      {connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Boards</TableHead>
                  <TableHead className="text-center">Pins</TableHead>
                  <TableHead>Last Synced</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.nickname || c.profileName || 'Unknown'}
                    </TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell className="text-center">{c.boards?.length ?? 0}</TableCell>
                    <TableCell className="text-center">{c._count?.scheduledPins ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleDateString() : 'Never'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Accounts Tab ─────────────────────────────────────────────────────
function AccountsTab({ connections, mutate }: { connections: PinterestConnection[]; mutate: () => void }) {
  const [connecting, setConnecting] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNickname, setEditNickname] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const res = await apiFetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to connect')

      // If OAuth, redirect to Pinterest
      if (data.oauth && data.url) {
        window.location.href = data.url
        return
      }

      // Simulated connection
      toast.success('Demo account connected! (Pinterest OAuth not configured)')
      mutate()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  const handleReconnect = async (connectionId: string) => {
    setReconnectingId(connectionId)
    try {
      const res = await apiFetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to connect')
      if (data.oauth && data.url) {
        window.location.href = data.url
        return
      }
      toast.error('Pinterest OAuth not configured')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Reconnection failed')
    } finally {
      setReconnectingId(null)
    }
  }

  const handleSync = async (connectionId: string) => {
    setSyncingId(connectionId)
    try {
      const res = await apiFetch('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId }) })
      const data = await res.json()
      if (!res.ok) {
        if (data.needsReauth) {
          toast.error('Token expired. Please click Reconnect to re-authorize.')
          mutate()
        } else {
          toast.error(data.error || 'Failed to sync boards')
        }
        return
      }
      toast.success(`Boards synced! ${data.count ?? 0} boards found`)
      mutate()
    } catch {
      toast.error('Failed to sync boards')
    } finally {
      setSyncingId(null)
    }
  }

  const handleSaveNickname = async (id: string) => {
    try {
      const res = await apiFetch(`/api/connections/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: editNickname }) })
      if (!res.ok) throw new Error()
      toast.success('Nickname updated')
      setEditingId(null)
      mutate()
    } catch {
      toast.error('Failed to update nickname')
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      const res = await apiFetch(`/api/connections/${deletingId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Account removed')
      setDeletingId(null)
      mutate()
    } catch {
      toast.error('Failed to remove account')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage your connected Pinterest accounts</p>
        <Button onClick={handleConnect} disabled={connecting} className="bg-pin-600 hover:bg-pin-700 text-white">
          {connecting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlusCircle className="mr-2 size-4" />}
          Connect New Account
        </Button>
      </div>

      {connections.length === 0 ? (
        <Card className="p-8 text-center">
          <Link2 className="mx-auto mb-3 size-10 text-muted-foreground" />
          <h3 className="text-lg font-semibold">No accounts connected</h3>
          <p className="mt-1 text-sm text-muted-foreground">Connect your first Pinterest account to get started.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <Card key={conn.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {conn.profileImageUrl ? (
                      <img src={conn.profileImageUrl} alt="" className="size-10 rounded-full object-cover" />
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded-full bg-pin-100 text-pin-700 dark:bg-pin-900/40 dark:text-pin-400 font-semibold">
                        {(conn.profileName || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div>
                      {editingId === conn.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editNickname}
                            onChange={(e) => setEditNickname(e.target.value)}
                            className="h-7 w-32 text-sm"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNickname(conn.id); if (e.key === 'Escape') setEditingId(null) }}
                            autoFocus
                          />
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => handleSaveNickname(conn.id)}><Check className="size-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditingId(null)}><X className="size-3.5" /></Button>
                        </div>
                      ) : (
                        <CardTitle className="text-base">{conn.nickname || conn.profileName || 'Unknown'}</CardTitle>
                      )}
                      <p className="text-xs text-muted-foreground">{conn.profileName}</p>
                    </div>
                  </div>
                  <StatusBadge status={conn.status} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                  <div className="rounded-md bg-muted p-2 text-center">
                    <p className="font-semibold">{conn.boards?.length ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Boards</p>
                  </div>
                  <div className="rounded-md bg-muted p-2 text-center">
                    <p className="font-semibold">{conn._count?.scheduledPins ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Pins</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Last synced: {conn.lastSyncedAt ? new Date(conn.lastSyncedAt).toLocaleString() : 'Never'}
                </p>
                <div className="flex gap-2">
                  {conn.status === 'reauth_required' ? (
                    <Button
                      variant="outline" size="sm" className="flex-1 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                      disabled={reconnectingId === conn.id}
                      onClick={() => handleReconnect(conn.id)}
                    >
                      {reconnectingId === conn.id ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <LogIn className="mr-1.5 size-3.5" />}
                      Reconnect
                    </Button>
                  ) : (
                    <>
                      {editingId !== conn.id && (
                        <Button
                          variant="outline" size="sm" className="flex-1"
                          onClick={() => { setEditingId(conn.id); setEditNickname(conn.nickname || '') }}
                        >
                          <Pencil className="mr-1.5 size-3.5" /> Edit
                        </Button>
                      )}
                      <Button
                        variant="outline" size="sm" className="flex-1"
                        disabled={syncingId === conn.id}
                        onClick={() => handleSync(conn.id)}
                      >
                        {syncingId === conn.id ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <FolderSync className="mr-1.5 size-3.5" />}
                        Sync
                      </Button>
                    </>
                  )}
                  <AlertDialog open={deletingId === conn.id} onOpenChange={(open) => setDeletingId(open ? conn.id : null)}>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="icon" className="size-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeletingId(conn.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove Account</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to remove <strong>{conn.nickname || conn.profileName}</strong>? This will remove all associated data.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white">Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Boards Tab (Create Board + live board list per account) ─────────
function BoardsTab({ connections, mutate }: { connections: PinterestConnection[]; mutate: () => void }) {
  const storeConnId = useAppStore((s) => s.selectedConnectionId)
  const [accountFilter, setAccountFilter] = useState<string>(storeConnId || connections[0]?.id || '')
  const [boards, setBoards] = useState<PinterestBoard[]>([])
  const [summary, setSummary] = useState<{ totalBoards: number; boardsWithPins: number; totalPins: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', privacy: 'PUBLIC' })

  // ── Bulk board create (CSV upload: column 1 = board name, column 2 = description) ──
  type BulkResult = { name: string; status: 'created' | 'skipped' | 'failed'; message: string }
  const [bulkRows, setBulkRows] = useState<{ name: string; description: string }[]>([])
  const [bulkFileName, setBulkFileName] = useState('')
  const bulkFileRef = useRef<HTMLInputElement>(null)
  const [bulkPrivacy, setBulkPrivacy] = useState('PUBLIC')
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([])
  const bulkCancelRef = useRef(false)
  const BULK_MAX = 100

  const effectiveConnId = accountFilter || connections[0]?.id || ''
  const activeConnections = connections.filter((c) => c.status !== 'disconnected')
  const selectedConn = connections.find((c) => c.id === effectiveConnId)

  // Load boards (from DB — fast) whenever the selected account changes
  const loadBoards = useCallback(async (connId: string) => {
    if (!connId) { setBoards([]); setSummary(null); return }
    setLoading(true)
    try {
      const res = await apiFetch(`/api/boards?connectionId=${connId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load boards')
      setBoards(data.boards || [])
      setSummary(data.summary || null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load boards')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Default to the store's selected account when the tab opens
    if (!accountFilter && storeConnId) setAccountFilter(storeConnId)
    if (effectiveConnId) loadBoards(effectiveConnId)
  }, [effectiveConnId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Full live sync from Pinterest (refreshes pin counts + detects deleted boards)
  const handleSync = async () => {
    if (!effectiveConnId) return
    setSyncing(true)
    try {
      const res = await apiFetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: effectiveConnId }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.needsReauth) {
          toast.error('Token expired. Please reconnect this account from the Accounts tab.')
          mutate()
        } else {
          toast.error(data.error || 'Failed to sync boards')
        }
        return
      }
      setBoards(data.boards || [])
      setSummary(data.summary || null)
      toast.success(`Synced! ${data.count ?? 0} boards on Pinterest`)
      mutate()
    } catch {
      toast.error('Failed to sync boards')
    } finally {
      setSyncing(false)
    }
  }

  // Create a board on the SELECTED Pinterest account
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveConnId) { toast.error('Select an account first'); return }
    if (!createForm.name.trim()) { toast.error('Board name is required'); return }
    setCreating(true)
    try {
      const res = await apiFetch('/api/boards/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: effectiveConnId,
          name: createForm.name.trim(),
          description: createForm.description.trim() || undefined,
          privacy: createForm.privacy,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.needsReauth) {
          toast.error('Token expired. Please reconnect this account from the Accounts tab.')
          mutate()
        } else {
          toast.error(data.error || 'Failed to create board')
        }
        return
      }
      toast.success(data.simulated
        ? `Board "${data.board.boardName}" created (demo mode)`
        : `Board "${data.board.boardName}" created on Pinterest!`)
      setCreateForm({ name: '', description: '', privacy: 'PUBLIC' })
      loadBoards(effectiveConnId)
      mutate()
    } catch {
      toast.error('Failed to create board')
    } finally {
      setCreating(false)
    }
  }

  // ── CSV parsing (handles quotes, commas inside quotes, BOM, \r\n) ──
  const parseCsvText = (text: string): string[][] => {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let inQuotes = false
    const src = text.replace(/^\uFEFF/, '')
    for (let i = 0; i < src.length; i++) {
      const ch = src[i]
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
        } else cell += ch
      } else if (ch === '"') inQuotes = true
      else if (ch === ',') { row.push(cell); cell = '' }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++
        row.push(cell); cell = ''
        rows.push(row); row = []
      } else cell += ch
    }
    if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
    return rows
  }

  const handleBulkFile = async (file: File | undefined) => {
    if (!file) return
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      toast.error('Please upload a .csv file')
      return
    }
    try {
      const rows = parseCsvText(await file.text()).filter((r) => r.some((c) => c.trim() !== ''))
      if (rows.length === 0) { toast.error('CSV is empty'); return }
      // Optional header row: first cell looks like "board_name" / "name" / "board"
      const first = (rows[0][0] || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
      const hasHeader = ['boardname', 'name', 'board', 'title', 'boardtitle'].includes(first)
      const dataRows = hasHeader ? rows.slice(1) : rows
      const seen = new Set<string>()
      const items: { name: string; description: string }[] = []
      let dupes = 0
      for (const r of dataRows) {
        const name = (r[0] || '').trim()
        const description = (r[1] || '').trim()
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) { dupes++; continue }
        seen.add(key)
        items.push({ name, description })
      }
      if (items.length === 0) { toast.error('No board names found in column 1'); return }
      if (items.length > BULK_MAX) {
        toast.error(`CSV has ${items.length} boards — max ${BULK_MAX} allowed. Only the first ${BULK_MAX} are loaded.`)
      }
      setBulkRows(items.slice(0, BULK_MAX))
      setBulkFileName(file.name)
      setBulkResults([])
      setBulkProgress({ done: 0, total: 0 })
      if (dupes > 0) toast.info(`${dupes} duplicate name${dupes === 1 ? '' : 's'} in CSV ignored`)
    } catch {
      toast.error('Could not read the CSV file')
    }
  }

  const clearBulk = () => {
    setBulkRows([])
    setBulkFileName('')
    setBulkResults([])
    setBulkProgress({ done: 0, total: 0 })
    if (bulkFileRef.current) bulkFileRef.current.value = ''
  }

  const downloadBulkSample = () => {
    const csv = 'board_name,board_description\n"Summer Recipes","Easy and fresh summer meal ideas"\n"Modern Living Room","Cozy and minimal living room inspiration"\n"Boho Bedroom",""\n'
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'boards-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Per-row validation (Pinterest limits) — invalid rows are skipped, not sent
  const bulkItems = bulkRows.map((r) => ({
    ...r,
    error: r.name.length > 180 ? 'Name is longer than 180 characters' : r.description.length > 500 ? 'Description is longer than 500 characters' : undefined,
  }))

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const handleBulkCreate = async () => {
    if (!effectiveConnId) { toast.error('Select an account first'); return }
    if (bulkItems.length === 0) { toast.error('Add at least one board name'); return }
    if (bulkItems.length > BULK_MAX) { toast.error(`Max ${BULK_MAX} boards at a time`); return }

    setBulkRunning(true)
    bulkCancelRef.current = false
    setBulkResults([])
    setBulkProgress({ done: 0, total: bulkItems.length })

    const results: BulkResult[] = []
    let stopped = false

    for (let i = 0; i < bulkItems.length; i++) {
      if (bulkCancelRef.current) { stopped = true; break }
      const item = bulkItems[i]

      if (item.error) {
        results.push({ name: item.name, status: 'skipped', message: item.error })
      } else {
        let attempt = 0
        while (true) {
          attempt++
          try {
            const res = await apiFetch('/api/boards/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                connectionId: effectiveConnId,
                name: item.name,
                description: item.description || undefined,
                privacy: bulkPrivacy,
              }),
            })
            const data = await res.json().catch(() => ({}))
            if (res.ok) {
              results.push({ name: item.name, status: 'created', message: 'Created' })
            } else if (res.status === 409) {
              results.push({ name: item.name, status: 'skipped', message: 'Already exists on this account' })
            } else if (data.needsReauth) {
              results.push({ name: item.name, status: 'failed', message: 'Token expired — reconnect the account' })
              stopped = true
              toast.error('Token expired. Please reconnect this account from the Accounts tab.')
              mutate()
            } else if (res.status === 429 && attempt <= 2) {
              await sleep(30_000) // Pinterest rate limit — wait and retry this same board
              continue
            } else if (res.status === 503 && attempt <= 3) {
              await sleep(5_000) // account busy publishing — retry shortly
              continue
            } else {
              results.push({ name: item.name, status: 'failed', message: data.error || 'Failed to create board' })
            }
          } catch {
            results.push({ name: item.name, status: 'failed', message: 'Network error' })
          }
          break
        }
      }

      setBulkResults([...results])
      setBulkProgress({ done: i + 1, total: bulkItems.length })
      if (stopped) break
      await sleep(700) // gentle pacing between Pinterest API calls
    }

    setBulkRunning(false)
    const created = results.filter((r) => r.status === 'created').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    const failed = results.filter((r) => r.status === 'failed').length
    if (created > 0) {
      toast.success(`${created} board${created === 1 ? '' : 's'} created${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}`)
    } else if (failed > 0) {
      toast.error(`No boards created — ${failed} failed`)
    } else {
      toast.info('Nothing new to create')
    }
    loadBoards(effectiveConnId)
    mutate()
  }

  return (
    <div className="space-y-4">
      {/* Account selector + sync */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Label className="text-sm whitespace-nowrap">Account:</Label>
          <Select value={effectiveConnId} onValueChange={(v) => setAccountFilter(v)}>
            <SelectTrigger className="w-full sm:max-w-[280px]">
              <SelectValue placeholder={connections.length === 0 ? 'No accounts connected' : 'Select account'} />
            </SelectTrigger>
            <SelectContent>
              {activeConnections.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">Connect an account first</div>
              ) : (
                activeConnections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nickname || c.profileName || c.id.slice(0, 8)}
                    {c.status !== 'active' ? ` (${c.status})` : ''}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing || !effectiveConnId}
          className="gap-2"
        >
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sync Live from Pinterest
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Boards</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {loading && !summary ? <Skeleton className="h-8 w-16" /> : (summary?.totalBoards ?? boards.length)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-xs text-muted-foreground">
              on {selectedConn?.nickname || selectedConn?.profileName || 'this account'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Boards with Pins</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {loading && !summary ? <Skeleton className="h-8 w-16" /> : (summary?.boardsWithPins ?? boards.filter((b) => b.pinCount > 0).length)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-xs text-muted-foreground">boards that have at least one post</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Pins on Boards</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {loading && !summary ? <Skeleton className="h-8 w-16" /> : (summary?.totalPins ?? boards.reduce((s, b) => s + b.pinCount, 0)).toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-xs text-muted-foreground">live pin count (updated on sync)</p>
          </CardContent>
        </Card>
      </div>

      {/* Create Board form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlusCircle className="size-4 text-pin-600" />
            Create a Board
          </CardTitle>
          <CardDescription>
            The board is created on the selected account{selectedConn ? ` (${selectedConn.nickname || selectedConn.profileName})` : ''} via the official Pinterest API — it is instantly available for scheduling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="board-name">Board Name *</Label>
                <Input
                  id="board-name"
                  placeholder="e.g. Summer Recipes"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  maxLength={180}
                  disabled={creating || !effectiveConnId}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="board-privacy">Privacy</Label>
                <Select
                  value={createForm.privacy}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, privacy: v }))}
                  disabled={creating || !effectiveConnId}
                >
                  <SelectTrigger id="board-privacy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC">Public — anyone can see</SelectItem>
                    <SelectItem value="SECRET">Secret — only you & collaborators</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="board-desc">Description (optional)</Label>
              <Textarea
                id="board-desc"
                placeholder="What is this board about?"
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                maxLength={500}
                rows={2}
                disabled={creating || !effectiveConnId}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{createForm.name.length}/180 characters</p>
              <Button type="submit" disabled={creating || !effectiveConnId} className="bg-pin-600 hover:bg-pin-700 text-white gap-2">
                {creating ? <Loader2 className="size-4 animate-spin" /> : <PlusCircle className="size-4" />}
                Create Board
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Bulk Create Boards */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutGrid className="size-4 text-pin-600" />
            Bulk Create Boards
          </CardTitle>
          <CardDescription>
            Upload a CSV with <b>2 columns</b>: column 1 = <b>board name</b>, column 2 = <b>board description</b> (description can be empty). Max {BULK_MAX} boards per upload.
            Boards that already exist on this account are skipped automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={bulkFileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handleBulkFile(e.target.files?.[0])}
          />
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-md border border-dashed p-4">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => bulkFileRef.current?.click()}
              disabled={bulkRunning || !effectiveConnId}
            >
              <Upload className="size-4" />
              {bulkFileName ? 'Choose another CSV' : 'Upload CSV'}
            </Button>
            <div className="flex-1 min-w-0 text-sm">
              {bulkFileName ? (
                <span className="font-medium truncate block">{bulkFileName}</span>
              ) : (
                <span className="text-muted-foreground">No file selected</span>
              )}
            </div>
            {bulkFileName && !bulkRunning && (
              <Button type="button" variant="ghost" size="sm" onClick={clearBulk}>Clear</Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={downloadBulkSample}>
              <Download className="size-3.5" />
              Sample CSV
            </Button>
          </div>

          {bulkItems.length > 0 && !bulkRunning && bulkResults.length === 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Board name</TableHead>
                    <TableHead className="hidden sm:table-cell">Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bulkItems.map((b, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">
                        {b.name}
                        {b.error && <span className="ml-2 text-xs text-red-600">{b.error}</span>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground truncate max-w-[320px]">{b.description || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={bulkPrivacy} onValueChange={setBulkPrivacy} disabled={bulkRunning}>
                <SelectTrigger className="w-[210px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">Public — anyone can see</SelectItem>
                  <SelectItem value="SECRET">Secret — only you & collaborators</SelectItem>
                </SelectContent>
              </Select>
              <p className={`text-xs ${bulkItems.length > BULK_MAX ? 'text-red-600' : 'text-muted-foreground'}`}>
                {bulkItems.length} board{bulkItems.length === 1 ? '' : 's'} loaded (max {BULK_MAX})
              </p>
            </div>
            <div className="flex items-center gap-2">
              {bulkRunning && (
                <Button type="button" variant="outline" onClick={() => { bulkCancelRef.current = true }}>
                  Stop
                </Button>
              )}
              <Button
                type="button"
                onClick={handleBulkCreate}
                disabled={bulkRunning || !effectiveConnId || bulkItems.length === 0 || bulkItems.length > BULK_MAX}
                className="bg-pin-600 hover:bg-pin-700 text-white gap-2"
              >
                {bulkRunning ? <Loader2 className="size-4 animate-spin" /> : <PlusCircle className="size-4" />}
                {bulkRunning ? 'Creating…' : `Create ${bulkItems.length || ''} Boards`.replace('  ', ' ')}
              </Button>
            </div>
          </div>

          {(bulkRunning || bulkResults.length > 0) && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Progress value={bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0} />
                <p className="text-xs text-muted-foreground">
                  {bulkProgress.done} / {bulkProgress.total} processed
                </p>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border">
                <ul className="divide-y text-sm">
                  {bulkResults.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 px-3 py-2">
                      {r.status === 'created' && <CheckCircle2 className="size-4 shrink-0 text-green-600" />}
                      {r.status === 'skipped' && <AlertCircle className="size-4 shrink-0 text-yellow-600" />}
                      {r.status === 'failed' && <XCircle className="size-4 shrink-0 text-red-600" />}
                      <span className="truncate flex-1 font-medium">{r.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{r.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Boards list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Boards</CardTitle>
          <CardDescription>
            {selectedConn ? `Boards on ${selectedConn.nickname || selectedConn.profileName}` : 'Select an account to see its boards'}
            {' · '}
            {loading ? 'Loading…' : `${boards.length} board${boards.length === 1 ? '' : 's'}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!effectiveConnId ? (
            <div className="py-8 text-center">
              <Link2 className="mx-auto mb-3 size-10 text-muted-foreground" />
              <h3 className="text-lg font-semibold">No account selected</h3>
              <p className="mt-1 text-sm text-muted-foreground">Connect a Pinterest account first from the Accounts tab.</p>
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : boards.length === 0 ? (
            <div className="py-8 text-center">
              <LayoutGrid className="mx-auto mb-3 size-10 text-muted-foreground" />
              <h3 className="text-lg font-semibold">No boards yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">Create your first board above, or click &quot;Sync Live from Pinterest&quot; to pull existing boards.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Board</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead>Privacy</TableHead>
                  <TableHead className="text-right">Pins</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boards.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <LayoutGrid className="size-4 shrink-0 text-pin-600" />
                        <span className="max-w-[220px] truncate">{b.boardName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell max-w-[280px]">
                      <span className="text-muted-foreground text-sm truncate block">{b.boardDescription || '—'}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={b.privacy === 'SECRET' ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' : 'bg-pin-100 text-pin-700 dark:bg-pin-900/30 dark:text-pin-400'}>
                        {b.privacy === 'SECRET' ? 'Secret' : 'Public'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {b.pinCount > 0 ? (
                          <>
                            <CheckCircle2 className="size-3.5 text-green-600" />
                            <span className="font-medium tabular-nums">{b.pinCount.toLocaleString()}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground text-sm">No posts yet</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Create Pin Tab ───────────────────────────────────────────────────
function CreatePinTab({ connections }: { connections: PinterestConnection[] }) {
  const [form, setForm] = useState({
    connectionId: '', boardId: '', title: '', description: '', destinationUrl: '', imageUrl: '', altText: '',
  })
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now')
  const [scheduleAt, setScheduleAt] = useState('')
  const [boards, setBoards] = useState<PinterestBoard[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!form.connectionId) { setBoards([]); setForm((f) => ({ ...f, boardId: '' })); return }
    const conn = connections.find((c) => c.id === form.connectionId)
    if (conn?.boards?.length) {
      setBoards(conn.boards)
    } else {
      setBoards([])
      apiFetch(`/api/boards?connectionId=${form.connectionId}`)
        .then((r) => r.json())
        .then((data) => { if (data.boards) setBoards(data.boards) })
        .catch(() => {})
    }
  }, [form.connectionId, connections])

  const handleSubmit = async () => {
    if (!form.connectionId || !form.boardId || !form.title.trim() || !form.imageUrl.trim()) {
      toast.error('Please fill in all required fields')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        connectionId: form.connectionId, boardId: form.boardId,
        title: form.title, description: form.description,
        destinationUrl: form.destinationUrl, imageUrl: form.imageUrl,
        altText: form.altText, publishNow: scheduleMode === 'now',
      }
      if (scheduleMode === 'later' && scheduleAt) body.scheduledFor = new Date(scheduleAt).toISOString()
      const res = await apiFetch('/api/pins/single', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create pin')
      toast.success('Pin created successfully!')
      setForm({ connectionId: '', boardId: '', title: '', description: '', destinationUrl: '', imageUrl: '', altText: '' })
      setScheduleMode('now')
      setScheduleAt('')
      useAppStore.getState().triggerRefresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create pin')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Create a New Pin</CardTitle>
        <CardDescription>Fill in the details below to create and schedule a pin.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Connection *</Label>
            <Select value={form.connectionId} onValueChange={(v) => setForm((f) => ({ ...f, connectionId: v }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nickname || c.profileName || c.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Board *</Label>
            <Select value={form.boardId} onValueChange={(v) => setForm((f) => ({ ...f, boardId: v }))} disabled={!form.connectionId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={boards.length ? 'Select board' : 'Select connection first'} /></SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.boardName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Title *</Label>
          <Input placeholder="Pin title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </div>

        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea placeholder="Pin description (optional)" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>

        <div className="space-y-2">
          <Label>Destination URL</Label>
          <Input placeholder="https://example.com/page" value={form.destinationUrl} onChange={(e) => setForm((f) => ({ ...f, destinationUrl: e.target.value }))} />
        </div>

        <div className="space-y-2">
          <Label>Image URL *</Label>
          <Input placeholder="https://example.com/image.jpg" value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} />
        </div>

        <div className="space-y-2">
          <Label>Alt Text</Label>
          <Input placeholder="Image alt text (optional)" value={form.altText} onChange={(e) => setForm((f) => ({ ...f, altText: e.target.value }))} />
        </div>

        <div className="space-y-2">
          <Label>Schedule</Label>
          <RadioGroup value={scheduleMode} onValueChange={(v) => setScheduleMode(v as 'now' | 'later')} className="flex gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="now" id="now" />
              <Label htmlFor="now" className="font-normal cursor-pointer">Publish Now</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="later" id="later" />
              <Label htmlFor="later" className="font-normal cursor-pointer">Schedule for Later</Label>
            </div>
          </RadioGroup>
          {scheduleMode === 'later' && (
            <Input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          )}
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full bg-pin-600 hover:bg-pin-700 text-white">
          {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlusCircle className="mr-2 size-4" />}
          {scheduleMode === 'now' ? 'Publish Pin' : 'Schedule Pin'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Bulk Upload Tab ──────────────────────────────────────────────────
interface PreviewRow {
  rowNumber: number
  title: string
  board: string
  imageUrl: string
  scheduledFor: string | null
  status: string
  errors: string[]
}

function formatInterval(seconds: number): string {
  if (seconds <= 0) return '-'
  const mins = seconds / 60
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`
  if (mins >= 1) return `${Math.round(mins * 10) / 10}m`
  return `${Math.round(seconds)}s`
}

function BulkUploadTab({ connections }: { connections: PinterestConnection[] }) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [connectionId, setConnectionId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [csvRowCount, setCsvRowCount] = useState<number | null>(null)
  const [importMode, setImportMode] = useState<'exact' | 'auto'>('auto')
  // User picks the exact gap between pins directly now — a number plus a
  // unit (minutes / hours / days) — instead of an auto-calculated pacing
  // derived from the CSV row count.
  const [intervalValue, setIntervalValue] = useState('30')
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours' | 'days'>('minutes')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ batchId: string; totalRows: number; validRows: number; invalidRows: number; queuedRows: number; totalDays?: number; intervalSeconds?: number; intervalMinutes?: number; effectiveDailyTarget?: number } | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [errorSamples, setErrorSamples] = useState<{ row: number; title: string; errors: string[] }[]>([])
  const [availableBoards, setAvailableBoards] = useState<string[]>([])
  const [diagnostic, setDiagnostic] = useState<{ detectedHeaders: string[]; firstRow: Record<string, string> | null; totalRowsParsed: number; boardCount: number } | null>(null)
  const [dailyPinLimit, setDailyPinLimit] = useState(10)
  const [planInfo, setPlanInfo] = useState<{ name: string; monthlyQuota: number; usedThisMonth: number; maxRowsPerImport: number; maxConnectedAccounts: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Recent imports state
  const [recentBatches, setRecentBatches] = useState<ImportBatchWithRows[]>([])
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [detailBatch, setDetailBatch] = useState<ImportBatchWithRows | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [batchActionLoading, setBatchActionLoading] = useState<string | null>(null)

  // Hard minimum interval = 60 seconds (1 minute) — a basic safety floor so
  // nobody can accidentally hammer Pinterest's API with a 0-second gap.
  // Beyond that, the user is free to choose any interval, in any unit.
  const MIN_INTERVAL_SECONDS = 60

  // Fetch plan's daily pin limit + quota info
  useEffect(() => {
    apiFetch('/api/dashboard/stats')
      .then((r) => r.json())
      .then((data) => {
        const limit = data.dailyPinLimit || 10
        setDailyPinLimit(limit)
        setPlanInfo({
          name: data.currentPlan?.name || 'Free',
          monthlyQuota: data.monthlyQuota || 10,
          usedThisMonth: data.usedPinsThisMonth || 0,
          maxRowsPerImport: data.currentPlan?.maxRowsPerImport || 50,
          maxConnectedAccounts: data.accountLimit || 1,
        })
      })
      .catch(() => {})
  }, [refreshKey])

  // When a CSV file is selected, read it client-side to count rows (still
  // useful to show "X rows in your file" / estimate total days, just no
  // longer used to auto-set the interval).
  useEffect(() => {
    if (!file) { setCsvRowCount(null); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = String(e.target?.result || '')
      // Count non-empty lines (subtract header)
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim().length > 0)
      const rowCount = Math.max(0, lines.length - 1) // exclude header
      setCsvRowCount(rowCount)
    }
    reader.onerror = () => { setCsvRowCount(null) }
    reader.readAsText(file)
  }, [file])

  // Fetch recent import batches
  const fetchRecentBatches = useCallback(() => {
    setLoadingBatches(true)
    apiFetch('/api/import-batches?limit=10')
      .then((r) => r.json())
      .then((data) => { setRecentBatches(data.batches || []) })
      .catch(() => {})
      .finally(() => setLoadingBatches(false))
  }, [refreshKey])

  useEffect(() => { fetchRecentBatches() }, [fetchRecentBatches])

  // Auto-refresh recent batches every 15s so published counts update live
  useEffect(() => {
    const t = setInterval(() => {
      apiFetch('/api/import-batches?limit=10')
        .then((r) => r.json())
        .then((data) => { if (data.batches) setRecentBatches(data.batches) })
        .catch(() => {})
    }, 15000)
    return () => clearInterval(t)
  }, [])

  // Validate interval input — must be a positive number (unit-agnostic; the
  // actual floor in seconds is checked in intervalSeconds below, since 1 in
  // "days" is fine but 1 in "minutes" already clears the 60s floor anyway).
  const handleIntervalValueChange = (val: string) => {
    const num = parseFloat(val)
    if (val === '' || isNaN(num) || num < 0) {
      setIntervalValue(val)
    } else {
      setIntervalValue(val)
    }
  }

  // Derive seconds from the value + unit the user picked.
  const UNIT_SECONDS: Record<'minutes' | 'hours' | 'days', number> = { minutes: 60, hours: 3600, days: 86400 }
  const rawIntervalSec = (parseFloat(intervalValue) || 0) * UNIT_SECONDS[intervalUnit]
  const intervalSec = Math.max(MIN_INTERVAL_SECONDS, rawIntervalSec)
  const rawDailyTarget = intervalSec > 0 ? Math.round(86400 / intervalSec) : 1
  // This is purely informational (shown to the user) — it does NOT change
  // the actual schedule anymore. The real interval the user picked is always
  // honored; if it produces more than dailyPinLimit pins in 24h, the worker
  // (not this UI, not the upload route) pushes the overflow to the next day.
  const actualIntervalSec = intervalSec

  const handleUpload = async () => {
    if (!connectionId || !file) { toast.error('Please select a connection and a CSV file'); return }
    setUploading(true)
    setResult(null)
    setPreviewRows([])
    setErrorSamples([])
    setAvailableBoards([])
    setDiagnostic(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('connectionId', connectionId)
      fd.append('importMode', importMode)
      // Send the exact interval (in seconds) the user chose — the backend
      // schedules pins linearly using this, no more day-bucketed guessing.
      fd.append('intervalSeconds', String(intervalSec))
      const res = await apiFetch('/api/pins/bulk', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setResult({
        batchId: data.batch?.id,
        totalRows: data.validRows + (data.invalidRows || 0),
        validRows: data.validRows,
        invalidRows: data.invalidRows || 0,
        queuedRows: data.batch?.queuedRows ?? data.validRows,
        totalDays: data.totalDays,
        intervalSeconds: data.intervalSeconds,
        intervalMinutes: data.intervalMinutes,
        effectiveDailyTarget: data.dailyTarget,
      })
      setPreviewRows(data.previewRows || [])
      setErrorSamples(data.errors || [])
      setAvailableBoards(data.availableBoards || [])
      setDiagnostic(data.diagnostic || null)
      toast.success(`Successfully queued ${data.validRows} pins!`)
      useAppStore.getState().triggerRefresh()
      // Refresh the recent batches list so the new upload shows up immediately
      fetchRecentBatches()
      // Reset the file input so the user can upload another file
      setFile(null)
      setCsvRowCount(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleViewBatchDetail = async (batchId: string) => {
    setLoadingDetail(true)
    setDetailBatch(null)
    try {
      const res = await apiFetch(`/api/import-batches?batchId=${batchId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load batch')
      setDetailBatch(data.batch)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load batch')
    } finally {
      setLoadingDetail(false)
    }
  }

  // Batch-level pause/resume/cancel — affects ALL non-final pins in the batch
  const handleBatchAction = async (batchId: string, action: 'pause' | 'resume' | 'cancel') => {
    setBatchActionLoading(`${batchId}:${action}`)
    try {
      const res = await apiFetch('/api/import-batches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed to ${action} batch`)
      toast.success(`${action === 'pause' ? 'Paused' : action === 'resume' ? 'Resumed' : 'Canceled'} ${data.affected} pins`)
      fetchRecentBatches()
      // If the detail dialog is open for this batch, refresh it too
      if (detailBatch?.id === batchId) {
        handleViewBatchDetail(batchId)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} batch`)
    } finally {
      setBatchActionLoading(null)
    }
  }

  // Permanent batch deletion — removes the batch, all its import rows, and all
  // scheduled pins (including published ones) from the database. Cannot be undone.
  const handleDeleteBatch = async (batchId: string, fileName?: string) => {
    // Browser-level confirm — fast, no extra UI needed
    const confirmed = window.confirm(
      `Permanently delete this import?\n\n` +
      `File: ${fileName || 'Unknown'}\n\n` +
      `This will delete ALL pins (published, queued, failed) and import rows for this batch.\n` +
      `This action CANNOT be undone.`
    )
    if (!confirmed) return

    setBatchActionLoading(`${batchId}:delete`)
    try {
      const res = await apiFetch('/api/import-batches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete batch')
      toast.success(`Deleted ${data.pinsDeleted} pins and ${data.rowsDeleted} import rows`)
      fetchRecentBatches()
      // Close detail dialog if open for this batch
      if (detailBatch?.id === batchId) {
        setDetailBatch(null)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete batch')
    } finally {
      setBatchActionLoading(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="max-w-2xl space-y-6">
        {/* Plan & Quota Info — shown first so user understands their limits before uploading */}
        {planInfo && (
          <Card className={planInfo.usedThisMonth >= planInfo.monthlyQuota ? 'border-red-200 dark:border-red-800' : ''}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-pin-100 text-pin-700 dark:bg-pin-900/40 dark:text-pin-400">
                    {planInfo.name} Plan
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Monthly quota: <strong className={planInfo.usedThisMonth >= planInfo.monthlyQuota ? 'text-red-600' : 'text-foreground'}>
                      {planInfo.usedThisMonth} / {planInfo.monthlyQuota}
                    </strong> pins
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Max {planInfo.maxRowsPerImport} rows/import &bull; {dailyPinLimit} pins/day/account &bull; {planInfo.maxConnectedAccounts} accounts
                </span>
              </div>
              {planInfo.usedThisMonth >= planInfo.monthlyQuota && (
                <div className="mt-2 rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-2">
                  <p className="text-xs text-red-700 dark:text-red-400">
                    <AlertCircle className="inline size-3.5 mr-1 -mt-0.5" />
                    Monthly quota exhausted — bulk upload will fail. Go to Plan &amp; Payment to upgrade.
                  </p>
                </div>
              )}
              {csvRowCount !== null && csvRowCount > planInfo.maxRowsPerImport && (
                <div className="mt-2 rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-2">
                  <p className="text-xs text-red-700 dark:text-red-400">
                    <AlertCircle className="inline size-3.5 mr-1 -mt-0.5" />
                    Your CSV has {csvRowCount} rows but your plan allows max {planInfo.maxRowsPerImport} rows per import. Split the CSV or upgrade.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 1: Connection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-pin-600 text-white text-xs font-bold">1</span>
              Select Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a Pinterest account" /></SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nickname || c.profileName || c.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Show available boards for the selected connection so the user knows
                exactly what board_name values to use in their CSV. This is the #1
                cause of "invalid" rows — the CSV's board_name doesn't match the
                selected account's boards (different accounts have different boards). */}
            {connectionId && (() => {
              const conn = connections.find((c) => c.id === connectionId)
              const connBoards = conn?.boards || []
              return (
                <div className="space-y-3">
                  {/* Connection status warning — if not active, bulk upload pins will be paused by the worker */}
                  {conn && conn.status !== 'active' && (
                    <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-3">
                      <p className="text-xs font-medium text-red-700 dark:text-red-400">
                        <AlertCircle className="inline size-3.5 mr-1 -mt-0.5" />
                        This account's connection status is <strong>{conn.status}</strong>.
                        {conn.status === 'reauth_required'
                          ? ' Pins will be PAUSED until you reconnect. Go to the Accounts tab and click "Reconnect".'
                          : ' Pins may be paused by the worker. Please check the connection in the Accounts tab.'}
                      </p>
                    </div>
                  )}
                  <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 p-3">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1.5">
                      Available boards for this account ({connBoards.length}):
                    </p>
                    {connBoards.length === 0 ? (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        No boards synced. Go to the Accounts tab and click "Sync" on this connection first.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {connBoards.map((b) => (
                          <Badge key={b.id} variant="secondary" className="bg-white dark:bg-gray-950 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 text-xs">
                            {b.boardName}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Your CSV's <code className="rounded bg-muted px-1 py-0.5 text-xs">board_name</code> column must match one of these names (case-insensitive).
                    </p>
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>

        {/* Step 2: Upload CSV */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-pin-600 text-white text-xs font-bold">2</span>
              Upload CSV File
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center transition-colors hover:border-pin-500/50 hover:bg-pin-50/50 dark:hover:bg-pin-900/10"
            >
              {file ? (
                <div className="flex flex-col items-center gap-2 text-pin-600 dark:text-pin-400">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-5" />
                    <span className="font-medium">{file.name}</span>
                    <Button variant="ghost" size="icon" className="size-6" onClick={(e) => { e.stopPropagation(); setFile(null); setCsvRowCount(null) }}><X className="size-3.5" /></Button>
                  </div>
                  {csvRowCount !== null && (
                    <Badge variant="secondary" className="bg-pin-100 text-pin-700 dark:bg-pin-900/40 dark:text-pin-400">
                      {csvRowCount} rows detected
                    </Badge>
                  )}
                </div>
              ) : (
                <>
                  <Upload className="mb-2 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Click to select CSV file</p>
                  <p className="text-xs text-muted-foreground mt-1">or drag and drop — we'll auto-detect row count and suggest an interval</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null) }} />
          </CardContent>
        </Card>

        {/* Step 3: Import Mode */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-pin-600 text-white text-xs font-bold">3</span>
              Import Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <RadioGroup value={importMode} onValueChange={(v) => setImportMode(v as 'exact' | 'auto')}>
              <div className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-muted/50">
                <RadioGroupItem value="auto" id="auto" className="mt-0.5" />
                <div>
                  <Label htmlFor="auto" className="font-medium cursor-pointer">Custom Interval</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">You choose the gap between each pin — e.g. 1 pin every 30 minutes, every 2 hours, or every day.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-muted/50">
                <RadioGroupItem value="exact" id="exact" className="mt-0.5" />
                <div>
                  <Label htmlFor="exact" className="font-medium cursor-pointer">Exact Schedule</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Uses the <code className="rounded bg-muted px-1 py-0.5 text-xs">publish_at</code> column from your CSV (ISO 8601)</p>
                </div>
              </div>
            </RadioGroup>
            {importMode === 'auto' && (
              <div className="rounded-lg border border-pin-200 dark:border-pin-800 bg-pin-50/50 dark:bg-pin-900/10 p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="font-medium">Interval between pins</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Pick any gap you want — minutes, hours, or days between each pin on this account.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.5"
                      min={0}
                      value={intervalValue}
                      onChange={(e) => handleIntervalValueChange(e.target.value)}
                      className="w-24 text-center"
                    />
                    <Select value={intervalUnit} onValueChange={(v) => setIntervalUnit(v as 'minutes' | 'hours' | 'days')}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">Minutes</SelectItem>
                        <SelectItem value="hours">Hours</SelectItem>
                        <SelectItem value="days">Days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Row count info (no longer drives the interval — just context) */}
                {csvRowCount !== null && csvRowCount > 0 && (
                  <div className="rounded-md bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 p-3">
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      <strong>{csvRowCount} pins</strong> in your CSV, one every <strong>{formatInterval(actualIntervalSec)}</strong> → finishes in about{' '}
                      <strong>{Math.max(1, Math.ceil(((csvRowCount - 1) * actualIntervalSec) / 86400))} day(s)</strong>.
                    </p>
                  </div>
                )}

                {/* Live pacing info */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md bg-white dark:bg-gray-950 p-2.5 border">
                    <p className="text-xs text-muted-foreground">Interval between pins</p>
                    <p className="text-base font-semibold mt-0.5">{formatInterval(actualIntervalSec)}</p>
                  </div>
                  <div className="rounded-md bg-white dark:bg-gray-950 p-2.5 border">
                    <p className="text-xs text-muted-foreground">≈ Pins in 24h</p>
                    <p className="text-base font-semibold mt-0.5">{Math.max(1, Math.floor(86400 / actualIntervalSec))}</p>
                  </div>
                  <div className="rounded-md bg-white dark:bg-gray-950 p-2.5 border">
                    <p className="text-xs text-muted-foreground">Days to finish</p>
                    <p className="text-base font-semibold mt-0.5">
                      {csvRowCount !== null
                        ? Math.max(1, Math.ceil(((csvRowCount - 1) * actualIntervalSec) / 86400))
                        : '-'}
                    </p>
                  </div>
                </div>

                {/* Plan limit warning — if the chosen interval would exceed the account's daily cap */}
                {rawDailyTarget > dailyPinLimit && (
                  <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 p-3">
                    <p className="text-xs text-yellow-700 dark:text-yellow-400">
                      <AlertCircle className="inline size-3.5 mr-1 -mt-0.5" />
                      Your plan allows max <strong>{dailyPinLimit} pins/day</strong> on this account. At this interval that would be ~<strong>{Math.max(1, Math.floor(86400 / actualIntervalSec))} pins/day</strong> — pins beyond the daily cap will automatically be pushed to the next day by the worker. Upgrade your plan to publish faster without delays.
                    </p>
                  </div>
                )}

                <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 p-3">
                  <p className="text-xs text-yellow-700 dark:text-yellow-400">
                    <AlertCircle className="inline size-3.5 mr-1 -mt-0.5" />
                    Safety floor: <strong>1 minute</strong> minimum between pins. You can go as slow as you like — hours, days, even weeks apart.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* CSV Format Reference */}
        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors">
            <span className="flex items-center gap-2"><FileText className="size-4" /> CSV Format Reference</span>
            <ChevronRight className="size-4 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2">
              <CardContent className="p-4">
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`title,description,board_name,image_url,destination_url,publish_at,alt_text
My Pin Title,Description here,My Board,https://img.com/1.jpg,https://example.com,2025-01-15T10:00:00Z,Alt text
Another Pin,Another desc,My Board,https://img.com/2.jpg,,2025-01-16T14:30:00Z,`}</pre>
                <p className="mt-2 text-xs text-muted-foreground">
                  <strong>Required columns:</strong> title, board_name, image_url<br />
                  <strong>Optional columns:</strong> description, destination_url, publish_at (ISO 8601, used by Exact Schedule), alt_text<br />
                  <strong>Board matching:</strong> board_name must match one of your synced Pinterest board names (case-insensitive).
                </p>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {/* Upload Button */}
        <Button onClick={handleUpload} disabled={uploading || !connectionId || !file} size="lg" className="w-full bg-pin-600 hover:bg-pin-700 text-white">
          {uploading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
          {uploading ? 'Uploading...' : 'Upload & Schedule Pins'}
        </Button>

        {/* Results Summary */}
        {result && (
          <Card className="border-pin-200 dark:border-pin-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="size-5 text-pin-600" />
                Upload Complete
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md bg-muted p-3 text-center">
                  <p className="text-2xl font-bold">{result.totalRows}</p>
                  <p className="text-xs text-muted-foreground">Total Rows</p>
                </div>
                <div className="rounded-md bg-pin-50 dark:bg-pin-900/20 p-3 text-center">
                  <p className="text-2xl font-bold text-pin-600">{result.validRows}</p>
                  <p className="text-xs text-muted-foreground">Valid</p>
                </div>
                <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-600">{result.queuedRows}</p>
                  <p className="text-xs text-muted-foreground">Queued</p>
                </div>
                <div className={`rounded-md p-3 text-center ${result.invalidRows > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-muted'}`}>
                  <p className={`text-2xl font-bold ${result.invalidRows > 0 ? 'text-red-600' : ''}`}>{result.invalidRows}</p>
                  <p className="text-xs text-muted-foreground">Invalid</p>
                </div>
              </div>
              {/* Pacing summary */}
              {importMode === 'auto' && (
                <div className="mt-3 rounded-md bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 p-3">
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
                    {result.totalDays && result.totalDays > 1
                      ? `${result.queuedRows} pins will be published over ${result.totalDays} days`
                      : `${result.queuedRows} pins will be published in 24 hours`}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    {result.effectiveDailyTarget} pins/day/account &bull; {formatInterval(result.intervalSeconds || 0)} between each pin
                  </p>
                </div>
              )}
              {/* Validation error samples */}
              {errorSamples.length > 0 && (
                <div className="mt-3 rounded-md bg-red-50 dark:bg-red-900/20 p-3">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    Validation Errors ({errorSamples.length} row{errorSamples.length !== 1 ? 's' : ''}):
                  </p>
                  <ul className="mt-1 text-xs text-red-600 dark:text-red-400 space-y-1 max-h-40 overflow-y-auto">
                    {errorSamples.map((e, i) => (
                      <li key={i}><strong>Row {e.row}</strong> ({e.title.slice(0, 40)}{e.title.length > 40 ? '…' : ''}): {e.errors.join('; ')}</li>
                    ))}
                  </ul>
                </div>
              )}
              {/* View full batch detail button */}
              {result.batchId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => handleViewBatchDetail(result.batchId)}
                >
                  <FileText className="mr-1.5 size-3.5" /> View Full Pin List & Status
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Diagnostic info — shows what the backend actually parsed from the CSV.
            This is CRITICAL for debugging when bulk upload fails but single pin works.
            Common issues this reveals: BOM in headers, wrong column names, etc. */}
        {diagnostic && (
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-muted px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors">
              <span className="flex items-center gap-2">
                <AlertCircle className="size-4 text-blue-500" />
                Diagnostic Info (parsed CSV data)
              </span>
              <ChevronRight className="size-4 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-2">
                <CardContent className="p-4 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Detected CSV Headers ({diagnostic.detectedHeaders.length}):</p>
                    <div className="flex flex-wrap gap-1">
                      {diagnostic.detectedHeaders.map((h, i) => (
                        <Badge key={i} variant="secondary" className="bg-muted text-xs font-mono">{h}</Badge>
                      ))}
                    </div>
                  </div>
                  {diagnostic.firstRow && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">First Row Values:</p>
                      <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs font-mono">{JSON.stringify(diagnostic.firstRow, null, 2)}</pre>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-muted p-2">
                      <span className="text-muted-foreground">Rows parsed:</span> <strong>{diagnostic.totalRowsParsed}</strong>
                    </div>
                    <div className="rounded-md bg-muted p-2">
                      <span className="text-muted-foreground">Boards in DB:</span> <strong>{diagnostic.boardCount}</strong>
                    </div>
                  </div>
                  {availableBoards.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Available Board Names (must match CSV board_name):</p>
                      <div className="flex flex-wrap gap-1">
                        {availableBoards.map((b, i) => (
                          <Badge key={i} variant="secondary" className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 text-xs">{b}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* CSV Data Preview (after upload) */}
      {previewRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="size-5 text-pin-600" />
              CSV Data Preview
              <Badge variant="secondary" className="ml-1">{previewRows.length} rows shown</Badge>
            </CardTitle>
            <CardDescription>First {Math.min(previewRows.length, 200)} rows from your uploaded CSV with their scheduled publish time</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[500px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Board</TableHead>
                    <TableHead>Scheduled For</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell className="text-muted-foreground text-xs">{row.rowNumber}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate" title={row.title}>{row.title}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{row.board}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {row.scheduledFor ? new Date(row.scheduledFor).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>
                        {row.status === 'valid'
                          ? <Badge variant="secondary" className="bg-pin-100 text-pin-700 dark:bg-pin-900/40 dark:text-pin-400">Queued</Badge>
                          : <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" title={row.errors.join('; ')}>Invalid</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Imports */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="size-5 text-pin-600" />
            Recent Imports
          </CardTitle>
          <CardDescription>Your last 10 bulk uploads with live publishing status. Updates every 15 seconds.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loadingBatches ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : recentBatches.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No imports yet. Upload a CSV to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-center">Valid</TableHead>
                    <TableHead className="text-center">Queued</TableHead>
                    <TableHead className="text-center">Published</TableHead>
                    <TableHead className="text-center">Paused</TableHead>
                    <TableHead className="text-center">Failed</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentBatches.map((b) => {
                    const sb = b.statusBreakdown || {}
                    const published = sb.published || 0
                    const failed = (sb.failed_final || 0) + (sb.retry_waiting || 0)
                    const queued = (sb.queued || 0) + (sb.publishing || 0)
                    const paused = sb.paused || 0
                    const canceled = sb.canceled || 0
                    // Determine which batch-level actions are available
                    const hasActivePins = queued > 0 || paused > 0 // pins that can be paused/resumed/canceled
                    const hasPausedPins = paused > 0
                    const hasQueuedPins = queued > 0
                    const isFullyDone = queued === 0 && paused === 0 // everything either published, failed, or canceled
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium max-w-[180px] truncate" title={b.originalFileName || ''}>
                          {b.originalFileName || 'Unknown file'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {b.connection?.nickname || b.connection?.profileName || '-'}
                        </TableCell>
                        <TableCell className="text-center text-pin-600 font-medium">{b.validRows}</TableCell>
                        <TableCell className="text-center text-yellow-600 font-medium">{queued}</TableCell>
                        <TableCell className="text-center text-pin-600 font-medium">{published}</TableCell>
                        <TableCell className="text-center text-orange-600 font-medium">{paused}</TableCell>
                        <TableCell className="text-center text-red-600 font-medium">{failed + canceled}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(b.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Pause button — only if there are queued/publishing pins */}
                            {hasQueuedPins && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                disabled={batchActionLoading === `${b.id}:pause`}
                                onClick={() => handleBatchAction(b.id, 'pause')}
                                title="Pause all pending pins in this batch"
                              >
                                {batchActionLoading === `${b.id}:pause`
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <PauseCircle className="size-3.5" />}
                              </Button>
                            )}
                            {/* Resume button — only if there are paused pins */}
                            {hasPausedPins && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-pin-600 hover:text-pin-700 hover:bg-pin-50 dark:hover:bg-pin-900/20"
                                disabled={batchActionLoading === `${b.id}:resume`}
                                onClick={() => handleBatchAction(b.id, 'resume')}
                                title="Resume paused pins"
                              >
                                {batchActionLoading === `${b.id}:resume`
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <PlayCircle className="size-3.5" />}
                              </Button>
                            )}
                            {/* Cancel button — only if there are active (non-final) pins */}
                            {hasActivePins && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                disabled={batchActionLoading === `${b.id}:cancel`}
                                onClick={() => handleBatchAction(b.id, 'cancel')}
                                title="Cancel all pending pins in this batch"
                              >
                                {batchActionLoading === `${b.id}:cancel`
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <XCircle className="size-3.5" />}
                              </Button>
                            )}
                            {/* View button — always available */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2"
                              disabled={loadingDetail}
                              onClick={() => handleViewBatchDetail(b.id)}
                            >
                              {loadingDetail && detailBatch === null ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <FileText className="mr-1.5 size-3.5" />}
                              View
                            </Button>
                            {isFullyDone && (
                              <Badge variant="secondary" className="ml-1 bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">done</Badge>
                            )}
                            {/* Permanent delete — removes batch + all pins + import rows from DB */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                              disabled={batchActionLoading === `${b.id}:delete`}
                              onClick={() => handleDeleteBatch(b.id, b.originalFileName || undefined)}
                              title="Permanently delete this batch and all its pins"
                            >
                              {batchActionLoading === `${b.id}:delete`
                                ? <Loader2 className="size-3.5 animate-spin" />
                                : <Trash2 className="size-3.5" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch Detail Dialog */}
      <Dialog open={!!detailBatch} onOpenChange={(open) => { if (!open) setDetailBatch(null) }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5" />
              {detailBatch?.originalFileName || 'Batch Detail'}
            </DialogTitle>
          </DialogHeader>
          {detailBatch && (
            <div className="overflow-y-auto flex-1 -mx-6 px-6">
              {/* Status summary */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                <div className="rounded-md bg-muted p-2.5 text-center">
                  <p className="text-lg font-bold">{detailBatch.totalRows}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
                <div className="rounded-md bg-pin-50 dark:bg-pin-900/20 p-2.5 text-center">
                  <p className="text-lg font-bold text-pin-600">{detailBatch.validRows}</p>
                  <p className="text-xs text-muted-foreground">Valid</p>
                </div>
                <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-2.5 text-center">
                  <p className="text-lg font-bold text-yellow-600">{detailBatch.queuedRows}</p>
                  <p className="text-xs text-muted-foreground">Queued</p>
                </div>
                <div className="rounded-md bg-pin-50 dark:bg-pin-900/20 p-2.5 text-center">
                  <p className="text-lg font-bold text-pin-600">{detailBatch.statusCounts?.published || 0}</p>
                  <p className="text-xs text-muted-foreground">Published</p>
                </div>
                <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-2.5 text-center">
                  <p className="text-lg font-bold text-red-600">{(detailBatch.statusCounts?.failed_final || 0) + (detailBatch.statusCounts?.retry_waiting || 0) + (detailBatch.statusCounts?.paused || 0)}</p>
                  <p className="text-xs text-muted-foreground">Failed/Paused</p>
                </div>
              </div>

              {detailBatch.importMode === 'auto_pacing' && detailBatch.dailyTarget && (
                <div className="rounded-md bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 p-2.5 mb-4">
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Custom Interval: {detailBatch.dailyTarget} pins/day &bull; {formatInterval(86400 / detailBatch.dailyTarget)} between each pin
                  </p>
                </div>
              )}

              {/* Rows table */}
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Board</TableHead>
                    <TableHead>Scheduled For</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Published At</TableHead>
                    <TableHead className="hidden lg:table-cell">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailBatch.rows?.map((row: ImportRowDetail) => {
                    const pin = row.scheduledPin
                    const status = pin?.status || (row.validationStatus === 'invalid' ? 'invalid' : 'pending')
                    const errs = row.validationErrors ? JSON.parse(row.validationErrors) : []
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground text-xs">{row.rowNumber}</TableCell>
                        <TableCell className="font-medium max-w-[200px] truncate" title={row.title || ''}>{row.title || '(empty)'}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{row.resolvedBoard?.boardName || row.boardInput || '-'}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {pin?.scheduledFor ? new Date(pin.scheduledFor).toLocaleString() : (row.publishAt ? new Date(row.publishAt).toLocaleString() : '-')}
                        </TableCell>
                        <TableCell><StatusBadge status={status} /></TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {pin?.publishedAt ? new Date(pin.publishedAt).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell max-w-[200px] truncate text-red-500 text-xs" title={pin?.lastError || errs.join('; ') || ''}>
                          {pin?.lastError || errs.join('; ') || '-'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {loadingDetail && !detailBatch && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Scheduled Pins Tab ───────────────────────────────────────────────
function ScheduledTab({ connections }: { connections: PinterestConnection[] }) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [pins, setPins] = useState<ScheduledPin[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filterConn, setFilterConn] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [clearingHistory, setClearingHistory] = useState(false)
  const limit = 100

  const fetchPins = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (filterConn) params.set('connectionId', filterConn)
    if (filterStatus) params.set('status', filterStatus)
    apiFetch(`/api/scheduled-pins?${params}`)
      .then((r) => r.json())
      .then((data) => { setPins(data.pins || []); setTotal(data.total || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, filterConn, filterStatus, refreshKey])

  useEffect(() => { fetchPins() }, [fetchPins])

  const handleAction = async (pinId: string, action: string) => {
    setActionLoading(pinId)
    try {
      const res = await apiFetch('/api/scheduled-pins', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinId, action }) })
      if (!res.ok) throw new Error()
      toast.success(`Pin ${action}d successfully`)
      fetchPins()
    } catch {
      toast.error(`Failed to ${action} pin`)
    } finally {
      setActionLoading(null)
    }
  }

  // Clear History — permanently deletes all published + canceled pins.
  // Queued/paused/failed pins are kept (user might still want to act on them).
  // Two-step confirmation because this is a destructive, irreversible action.
  const handleClearHistory = async () => {
    const confirmed = window.confirm(
      `Clear history?\n\n` +
      `This will PERMANENTLY DELETE all published and canceled pins from your history.\n` +
      `Queued, paused, and failed pins will be kept.\n\n` +
      `This action CANNOT be undone.`
    )
    if (!confirmed) return

    setClearingHistory(true)
    try {
      const res = await apiFetch('/api/scheduled-pins', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'history' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to clear history')
      toast.success(`Deleted ${data.deleted} pins from history`)
      setPage(1)
      fetchPins()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear history')
    } finally {
      setClearingHistory(false)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select value={filterConn} onValueChange={(v) => { setFilterConn(v === '__all__' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Accounts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Accounts</SelectItem>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nickname || c.profileName || c.id.slice(0, 8)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v === '__all__' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Status</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="publishing">Publishing</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-800"
          disabled={clearingHistory || total === 0}
          onClick={handleClearHistory}
          title="Permanently delete all published and canceled pins from history"
        >
          {clearingHistory ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Trash2 className="mr-1.5 size-3.5" />}
          Clear History
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Board</TableHead>
                <TableHead>Scheduled For</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Attempts</TableHead>
                <TableHead className="hidden lg:table-cell">Error</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell><Skeleton className="h-4 w-32" /></TableCell><TableCell><Skeleton className="h-4 w-20" /></TableCell><TableCell><Skeleton className="h-4 w-28" /></TableCell><TableCell><Skeleton className="h-5 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-6 mx-auto" /></TableCell><TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell><TableCell /></TableRow>
                ))
              ) : pins.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No scheduled pins found</TableCell></TableRow>
              ) : (
                pins.map((pin) => (
                  <TableRow key={pin.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">{pin.title || 'Untitled'}</TableCell>
                    <TableCell className="text-muted-foreground">{pin.board?.boardName || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {pin.scheduledFor ? new Date(pin.scheduledFor).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell><StatusBadge status={pin.status} /></TableCell>
                    <TableCell className="text-center">{pin.attemptCount}</TableCell>
                    <TableCell className="hidden lg:table-cell max-w-[200px] truncate text-red-500 text-xs">{pin.lastError || '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {(pin.status === 'failed') && (
                          <Button variant="ghost" size="icon" className="size-7" disabled={actionLoading === pin.id} onClick={() => handleAction(pin.id, 'retry')} title="Retry">
                            <RefreshCw className="size-3.5" />
                          </Button>
                        )}
                        {(pin.status === 'queued' || pin.status === 'publishing') && (
                          <Button variant="ghost" size="icon" className="size-7" disabled={actionLoading === pin.id} onClick={() => handleAction(pin.id, 'pause')} title="Pause">
                            <PauseCircle className="size-3.5" />
                          </Button>
                        )}
                        {pin.status === 'paused' && (
                          <Button variant="ghost" size="icon" className="size-7" disabled={actionLoading === pin.id} onClick={() => handleAction(pin.id, 'resume')} title="Resume">
                            <PlayCircle className="size-3.5" />
                          </Button>
                        )}
                        {(pin.status === 'queued' || pin.status === 'paused' || pin.status === 'failed') && (
                          <Button variant="ghost" size="icon" className="size-7 text-red-500" disabled={actionLoading === pin.id} onClick={() => handleAction(pin.id, 'cancel')} title="Cancel">
                            <XCircle className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}

// ─── Analytics Tab ──────────────────────────────────────────────────
type AnalyticsRangeKey = 'today' | '7d' | '15d' | '30d' | 'custom'

interface AnalyticsMetrics {
  pinsPublished: number
  impressions: number
  pinClicks: number
  outboundClicks: number
  saves: number
  engagements: number
  engagementRate: number
  apiCalls: number
}

interface TopPin {
  id: string
  title: string
  imageUrl: string | null
  url: string | null
  impressions: number
  engagements: number
}

const RANGE_OPTIONS: { key: AnalyticsRangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '15d', label: 'Last 15 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom range' },
]

function MetricCard({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">
          {value}{suffix && <span className="text-base font-normal text-muted-foreground"> {suffix}</span>}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

function AnalyticsTab({ connections }: { connections: PinterestConnection[] }) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [range, setRange] = useState<AnalyticsRangeKey>('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [filterConn, setFilterConn] = useState('')
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null)
  const [topPins, setTopPins] = useState<TopPin[]>([])
  const [analyticsMeta, setAnalyticsMeta] = useState<{ hasRealConnection: boolean; accountsIncluded: number; errors: string[]; reauthNeeded: string[]; dataThrough: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const fetchAnalytics = useCallback(() => {
    if (range === 'custom' && (!customFrom || !customTo)) return
    setLoading(true)
    const params = new URLSearchParams({ range })
    if (range === 'custom') { params.set('from', customFrom); params.set('to', customTo) }
    if (filterConn) params.set('connectionId', filterConn)
    apiFetch(`/api/analytics?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setMetrics(data.metrics || null)
        setTopPins(data.topPins || [])
        setAnalyticsMeta({
          hasRealConnection: data.hasRealConnection !== false,
          accountsIncluded: data.accountsIncluded || 0,
          errors: data.errors || [],
          reauthNeeded: data.reauthNeeded || [],
          dataThrough: data.dataThrough || null,
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [range, customFrom, customTo, filterConn, refreshKey])

  useEffect(() => { fetchAnalytics() }, [fetchAnalytics])

  const handleExport = async () => {
    if (range === 'custom' && (!customFrom || !customTo)) {
      toast.error('Pick a start and end date first')
      return
    }
    setExporting(true)
    try {
      const params = new URLSearchParams({ range })
      if (range === 'custom') { params.set('from', customFrom); params.set('to', customTo) }
      if (filterConn) params.set('connectionId', filterConn)
      const res = await apiFetch(`/api/analytics/export?${params}`)
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      a.download = match?.[1] || 'pindesk-analytics.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to export report')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Date Range</Label>
          <Select value={range} onValueChange={(v) => setRange(v as AnalyticsRangeKey)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {range === 'custom' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Account</Label>
          <Select value={filterConn} onValueChange={(v) => setFilterConn(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Accounts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Accounts</SelectItem>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nickname || c.profileName || c.id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" onClick={handleExport} disabled={exporting} className="ml-auto gap-2">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download CSV Report
        </Button>
      </div>

      {/* Live-fetch status note (only when there is something to flag) */}
      {!loading && analyticsMeta && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {analyticsMeta.dataThrough && (
            <p>Live from Pinterest organic analytics · data through {analyticsMeta.dataThrough} (Pinterest reports organic data with a delay of up to ~2 days)</p>
          )}
          {analyticsMeta.reauthNeeded.length > 0 && (
            <p className="text-amber-600 dark:text-amber-400">Reconnect needed for: {analyticsMeta.reauthNeeded.join(', ')}</p>
          )}
          {analyticsMeta.errors.length > 0 && (
            <p className="text-amber-600 dark:text-amber-400">{analyticsMeta.errors.length} account{analyticsMeta.errors.length > 1 ? 's' : ''} could not be fetched right now (rate limit or temporary Pinterest error) — other accounts are included. Try refreshing.</p>
          )}
          {!analyticsMeta.hasRealConnection && (
            <p className="text-amber-600 dark:text-amber-400">Connect a real Pinterest account to see live organic analytics — demo/simulated accounts don't have Pinterest analytics data.</p>
          )}
        </div>
      )}

      {/* Metric Cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : metrics ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Pins Published" value={metrics.pinsPublished.toLocaleString()} />
          <MetricCard label="Impressions" value={metrics.impressions.toLocaleString()} />
          <MetricCard label="Pin Clicks" value={metrics.pinClicks.toLocaleString()} />
          <MetricCard label="Outbound Clicks" value={metrics.outboundClicks.toLocaleString()} />
          <MetricCard label="Saves" value={metrics.saves.toLocaleString()} />
          <MetricCard label="Engagements" value={metrics.engagements.toLocaleString()} />
          <MetricCard label="Engagement Rate" value={metrics.engagementRate} suffix="%" />
          <MetricCard label="API Calls" value={metrics.apiCalls.toLocaleString()} />
        </div>
      ) : (
        <Card className="p-6"><p className="text-muted-foreground">Failed to load analytics.</p></Card>
      )}

      {/* Top 5 Pins */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-amber-500" /> Top 5 Pins
          </CardTitle>
          <CardDescription>Ranked by engagement for the selected range</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
            </div>
          ) : topPins.length === 0 ? (
            <p className="text-sm text-muted-foreground">No published pin activity in this range yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {topPins.map((pin, i) => (
                <div key={pin.id} className="overflow-hidden rounded-lg border bg-card">
                  <div className="relative aspect-square w-full bg-muted">
                    {pin.imageUrl ? (
                      <img src={pin.imageUrl} alt={pin.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <BarChart3 className="h-8 w-8" />
                      </div>
                    )}
                    <Badge className="absolute left-2 top-2 bg-amber-500 text-white hover:bg-amber-500">#{i + 1}</Badge>
                  </div>
                  <div className="space-y-1 p-3">
                    <p className="line-clamp-2 text-sm font-medium">{pin.title}</p>
                    <p className="text-xs text-muted-foreground">{pin.engagements.toLocaleString()} engagements &bull; {pin.impressions.toLocaleString()} impressions</p>
                    {pin.url && (
                      <a href={pin.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        View on Pinterest <ChevronRight className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Logs Tab ─────────────────────────────────────────────────────────
function LogsTab({ connections }: { connections: PinterestConnection[] }) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [logs, setLogs] = useState<ScheduledPin[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filterConn, setFilterConn] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [clearingHistory, setClearingHistory] = useState(false)
  const limit = 100

  const fetchLogs = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (filterConn) params.set('connectionId', filterConn)
    if (filterStatus) params.set('status', filterStatus)
    apiFetch(`/api/logs?${params}`)
      .then((r) => r.json())
      .then((data) => { setLogs(data.logs || []); setTotal(data.total || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, filterConn, filterStatus, refreshKey])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const handleRetry = async (pinId: string) => {
    setRetrying(pinId)
    try {
      const res = await apiFetch('/api/scheduled-pins', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinId, action: 'retry' }) })
      if (!res.ok) throw new Error()
      toast.success('Pin queued for retry')
      fetchLogs()
    } catch {
      toast.error('Failed to retry pin')
    } finally {
      setRetrying(null)
    }
  }

  // Clear History in Logs tab — permanently deletes all published + canceled + failed pins
  const handleClearLogsHistory = async () => {
    const confirmed = window.confirm(
      `Clear all logs?\n\n` +
      `This will PERMANENTLY DELETE all published, canceled, and failed pins from your logs.\n` +
      `This action CANNOT be undone.`
    )
    if (!confirmed) return

    setClearingHistory(true)
    try {
      const res = await apiFetch('/api/scheduled-pins', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all-final' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to clear logs')
      toast.success(`Deleted ${data.deleted} pins from logs`)
      setPage(1)
      fetchLogs()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear logs')
    } finally {
      setClearingHistory(false)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select value={filterConn} onValueChange={(v) => { setFilterConn(v === '__all__' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Accounts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Accounts</SelectItem>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nickname || c.profileName || c.id.slice(0, 8)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v === '__all__' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Status</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-800"
          disabled={clearingHistory || total === 0}
          onClick={handleClearLogsHistory}
          title="Permanently delete all published, canceled, and failed pins from logs"
        >
          {clearingHistory ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Trash2 className="mr-1.5 size-3.5" />}
          Clear All Logs
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Board</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Published At</TableHead>
                <TableHead className="hidden lg:table-cell">Error</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell><Skeleton className="h-4 w-32" /></TableCell><TableCell><Skeleton className="h-4 w-20" /></TableCell><TableCell><Skeleton className="h-5 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-28" /></TableCell><TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell><TableCell /></TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No logs found</TableCell></TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">{log.title || 'Untitled'}</TableCell>
                    <TableCell className="text-muted-foreground">{log.board?.boardName || '-'}</TableCell>
                    <TableCell><StatusBadge status={log.status} /></TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.publishedAt ? new Date(log.publishedAt).toLocaleString() : log.scheduledFor ? new Date(log.scheduledFor).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell max-w-[200px] truncate text-red-500 text-xs">{log.lastError || '-'}</TableCell>
                    <TableCell className="text-right">
                      {log.status === 'failed' && (
                        <Button variant="ghost" size="sm" disabled={retrying === log.id} onClick={() => handleRetry(log.id)}>
                          {retrying === log.id ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}

// ─── Plan & Payment Tab ───────────────────────────────────────────────
// ─── Monthly plan expiry (days left / expired) ──────────────────────
interface SubscriptionInfo {
  enforced: boolean
  active: boolean
  expiresAt: string | null
  daysLeft: number | null
  planName: string | null
  durationDays?: number
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Slim status strip shown at the top of the dashboard for paid plans. */
function PlanExpiryBanner({ onRenew }: { onRenew: () => void }) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [sub, setSub] = useState<SubscriptionInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      apiFetch('/api/subscription')
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setSub(d && typeof d.enforced === 'boolean' ? d : null) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [refreshKey])

  if (!sub || !sub.enforced) return null

  const expired = !sub.active
  const soon = !expired && (sub.daysLeft ?? 99) <= 5
  const tone = expired
    ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300'
    : soon
      ? 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-300'
      : 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300'

  return (
    <div className={`mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <div className="flex items-center gap-2">
        {expired ? <XCircle className="size-4 shrink-0" /> : soon ? <AlertCircle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
        <span>
          {expired
            ? <>Your <b>{sub.planName}</b> plan expired on {fmtDate(sub.expiresAt)}. Publishing is stopped — renew to resume automatically from where it stopped.</>
            : <><b>{sub.planName}</b> plan: <b>{sub.daysLeft} day{sub.daysLeft === 1 ? '' : 's'} left</b> (expires {fmtDate(sub.expiresAt)})</>}
        </span>
      </div>
      {(expired || soon) && (
        <Button size="sm" variant={expired ? 'default' : 'outline'} onClick={onRenew} className={expired ? 'bg-pin-600 hover:bg-pin-700 text-white' : ''}>
          Renew now
        </Button>
      )}
    </div>
  )
}

function PlanPaymentTab() {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [sub, setSub] = useState<SubscriptionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [txid, setTxid] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [binancePayId, setBinancePayId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'trc20' | 'binance'>('trc20')
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle')
  const [verifyMessage, setVerifyMessage] = useState('')
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [QrCodeComponent, setQrCodeComponent] = useState<React.ComponentType<any> | null>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    import('qrcode.react').then((mod) => {
      setQrCodeComponent(() => mod.QRCodeSVG)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.all([
        apiFetch('/api/dashboard/stats').then((r) => r.json()),
        apiFetch('/api/plans').then((r) => r.json()),
        apiFetch('/api/payment-orders').then((r) => r.json()),
        apiFetch('/api/payment-config').then((r) => r.json()),
        apiFetch('/api/subscription').then((r) => r.json()).catch(() => null),
      ])
        .then(([statsData, plansData, ordersData, configData, subData]) => {
          if (cancelled) return
          setSub(subData && typeof subData.enforced === 'boolean' ? subData : null)
          setStats(statsData)
          setPlans(plansData.plans || [])
          setOrders(ordersData.orders || [])
          if (configData.trc20) setWalletAddress(configData.trc20.walletAddress || '')
          if (configData.binance) setBinancePayId(configData.binance.payId || '')
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    load()
    // Auto-refresh every 30s so usage/quota and plan data stay fresh (the
    // worker increments usage counters in the background while publishing).
    const t = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(t) }
  }, [refreshKey])

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const startPolling = (orderId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch('/api/payment-orders')
        const data = await res.json()
        const updatedOrder = (data.orders || []).find((o: PaymentOrder) => o.id === orderId)
        if (updatedOrder && (updatedOrder.status === 'verified' || updatedOrder.status === 'failed_verification' || updatedOrder.status === 'rejected')) {
          if (pollRef.current) clearInterval(pollRef.current)
          setOrders(data.orders || [])
          setVerifying(false)
          if (updatedOrder.status === 'verified') {
            setVerifyStatus('success')
            setVerifyMessage('Payment verified! Your plan is now active.')
            useAppStore.getState().triggerRefresh()
            setShowPaymentForm(false)
            setSelectedPlanId('')
            setTxid('')
          } else {
            setVerifyStatus('error')
            setVerifyMessage(updatedOrder.verifyError || 'Payment verification failed.')
          }
        }
      } catch {}
    }, 10000)
  }

  const handleSelectPlan = async (planId: string) => {
    setSelectedPlanId(planId)
    setTxid('')
    setVerifyStatus('idle')
    setVerifyMessage('')
    setPaymentMethod('trc20')
    setShowPaymentForm(true)
  }

  const handleSubmitPayment = async () => {
    if (!selectedPlanId || !txid.trim()) { toast.error('Please enter your Transaction ID'); return }
    setSubmitting(true)
    try {
      const res = await apiFetch('/api/payment-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selectedPlanId, txid: txid.trim(), paymentMethod }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')

      if (paymentMethod === 'binance') {
        // Binance Pay: manual verification, no auto-verify
        setVerifyStatus('success')
        setVerifyMessage(`Binance Pay payment submitted! TXID: ${txid.trim()}. Our team will verify within 24 hours.`)
        toast.success('Payment submitted for manual review!')
        setOrders((prev) => [
          { ...data.order, plan: plans.find((p) => p.id === selectedPlanId) } as PaymentOrder,
          ...prev,
        ])
        startPolling(data.order.id)
      } else {
        // TRC20: auto-verify
        setVerifying(true)
        setVerifyStatus('verifying')
        setVerifyMessage('Verifying your payment on the blockchain...')
        toast.success('Order created! Verifying payment...')

        try {
          const verifyRes = await apiFetch('/api/payment-orders/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.order.id }),
          })
          const verifyData = await verifyRes.json()

          if (verifyData.success) {
            setVerifyStatus('success')
            setVerifyMessage(verifyData.message)
            toast.success(verifyData.message)
            setOrders((prev) =>
              prev.map((o) => (o.id === data.order.id ? { ...o, status: 'verified' } : o))
            )
            useAppStore.getState().triggerRefresh()
            setShowPaymentForm(false)
            setSelectedPlanId('')
            setTxid('')
          } else {
            setVerifyStatus('error')
            setVerifyMessage(verifyData.error || 'Verification failed')
            toast.error(verifyData.error || 'Verification failed')
            setOrders((prev) =>
              prev.map((o) => (o.id === data.order.id ? { ...o, status: 'failed_verification' } : o))
            )
            startPolling(data.order.id)
          }
        } catch {
          setVerifyStatus('error')
          setVerifyMessage('Network error during verification. Retrying...')
          startPolling(data.order.id)
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
      setVerifying(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied!`)).catch(() => toast.error('Failed to copy'))
  }

  const selectedPlan = plans.find((p) => p.id === selectedPlanId)

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // Features are stored in the DB as a JSON string array (e.g. '["a","b"]').
  // Parse safely and fall back to comma-splitting for legacy rows.
  const currentFeatures: string[] = (() => {
    const raw = stats?.currentPlan?.features
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((f) => typeof f === 'string') : []
    } catch {
      return raw.split(',').map((f) => f.trim()).filter(Boolean)
    }
  })()

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card className="border-pin-200 dark:border-pin-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Current Plan: {stats?.currentPlan?.name || 'Free'}</CardTitle>
              <CardDescription className="mt-1">Your current subscription details</CardDescription>
            </div>
            {sub?.enforced && !sub.active ? (
              <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 text-sm px-3 py-1">Expired</Badge>
            ) : (
              <Badge variant="secondary" className="bg-pin-100 text-pin-700 dark:bg-pin-900/40 dark:text-pin-400 text-sm px-3 py-1">Active</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {sub?.enforced && (
            <div className={`mb-4 rounded-md border p-3 ${sub.active ? ((sub.daysLeft ?? 99) <= 5 ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-900/20' : 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20') : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20'}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">
                  {sub.active
                    ? `${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'} remaining`
                    : 'Plan expired — publishing is stopped'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sub.active ? 'Expires' : 'Expired'} on {fmtDate(sub.expiresAt)}
                </p>
              </div>
              {sub.active && (
                <Progress className="mt-2 h-2" value={Math.min(100, ((sub.daysLeft ?? 0) / (sub.durationDays || 30)) * 100)} />
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {sub.active
                  ? 'Renew any time — 30 days are added on top of the days you have left.'
                  : 'Renew to continue — your scheduled pins resume automatically from where they stopped.'}
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Monthly Quota</p>
              <p className="text-lg font-semibold">{stats?.monthlyQuota ?? 0} pins</p>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Account Limit</p>
              <p className="text-lg font-semibold">{stats?.accountLimit ?? 0}</p>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Max Rows / Import</p>
              <p className="text-lg font-semibold">{stats?.currentPlan?.maxRowsPerImport ?? 0}</p>
            </div>
          </div>
          {currentFeatures.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Features:</p>
              <div className="flex flex-wrap gap-2">
                {currentFeatures.map((f, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{f}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Plans */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Upgrade Plan</h3>
        {plans.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">No plans available</Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.filter((p) => p.priceUsd && p.priceUsd > 0).map((plan) => {
              const isCurrent = stats?.currentPlan?.id === plan.id
              return (
                <Card key={plan.id} className={`relative overflow-hidden ${isCurrent ? 'border-pin-300 dark:border-pin-700 ring-1 ring-pin-300 dark:ring-pin-700' : 'hover:border-pin-200 dark:hover:border-pin-800 transition-colors'} ${selectedPlanId === plan.id ? 'ring-2 ring-pin-500 dark:ring-pin-400' : ''}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{plan.name}</CardTitle>
                      {isCurrent && <Badge className="bg-pin-600 text-white">Current</Badge>}
                    </div>
                    <CardTitle className="text-2xl">
                      {plan.priceUsd ? `$${plan.priceUsd}` : 'Free'}
                      {plan.priceUsd && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>• {plan.monthlyPinQuota.toLocaleString()} pins/month</p>
                    <p>• {plan.maxConnectedAccounts} accounts</p>
                    <p>• {plan.maxRowsPerImport.toLocaleString()} rows/import</p>
                    <p className="font-medium text-foreground">• Pay <span className="text-pin-600 dark:text-pin-400">${plan.priceUsd} USDT</span> (TRC20 or Binance Pay)</p>
                    {(!isCurrent || sub?.enforced) && (
                      <Button
                        className="w-full mt-3 bg-pin-600 hover:bg-pin-700 text-white"
                        onClick={() => handleSelectPlan(plan.id)}
                        disabled={verifying}
                      >
                        {selectedPlanId === plan.id && showPaymentForm ? 'Selected ✓' : isCurrent ? 'Renew +30 days' : 'Select & Pay'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Payment Form */}
      {showPaymentForm && selectedPlan && (
        <Card className="border-pin-300 dark:border-pin-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="size-5 text-pin-600" />
              Pay ${selectedPlan.priceUsd} USDT — {selectedPlan.name} Plan
            </CardTitle>
            <CardDescription>Choose a payment method below and follow the instructions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Verification status banner */}
            {verifyStatus !== 'idle' && (
              <div className={`rounded-lg p-4 ${
                verifyStatus === 'verifying' ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800' :
                verifyStatus === 'success' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' :
                'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
              }`}>
                <div className="flex items-start gap-2">
                  {verifyStatus === 'verifying' && <Loader2 className="size-5 animate-spin text-yellow-600 mt-0.5" />}
                  {verifyStatus === 'success' && <CheckCircle2 className="size-5 text-green-600 mt-0.5" />}
                  {verifyStatus === 'error' && <XCircle className="size-5 text-red-600 mt-0.5" />}
                  <p className={`text-sm font-medium ${
                    verifyStatus === 'verifying' ? 'text-yellow-700 dark:text-yellow-400' :
                    verifyStatus === 'success' ? 'text-green-700 dark:text-green-400' :
                    'text-red-700 dark:text-red-400'
                  }`}>{verifyMessage}</p>
                </div>
              </div>
            )}

            {/* Payment Method Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg">
              <button
                onClick={() => { setPaymentMethod('trc20'); setTxid(''); setVerifyStatus('idle'); setVerifyMessage('') }}
                className={`rounded-md px-3 py-2.5 text-sm font-medium transition-all ${paymentMethod === 'trc20' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                💳 TRC20 (USDT)
              </button>
              <button
                onClick={() => { setPaymentMethod('binance'); setTxid(''); setVerifyStatus('idle'); setVerifyMessage('') }}
                className={`rounded-md px-3 py-2.5 text-sm font-medium transition-all ${paymentMethod === 'binance' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                🟡 Binance Pay
              </button>
            </div>

            {/* TRC20 Payment */}
            {paymentMethod === 'trc20' && (
              <>
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <div className="rounded-xl border bg-white p-3 dark:bg-gray-950 shrink-0">
                    {walletAddress && QrCodeComponent ? (
                      <QrCodeComponent
                        value={walletAddress}
                        size={180}
                        level="M"
                        includeMargin={false}
                        fgColor="#000000"
                        bgColor="#ffffff"
                      />
                    ) : (
                      <div className="flex size-[180px] items-center justify-center text-muted-foreground">
                        <Skeleton className="size-full" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-3 text-center sm:text-left min-w-0">
                    <div>
                      <p className="text-sm font-medium">USDT Wallet Address (TRC20)</p>
                      <div className="mt-1.5 flex items-center gap-2 rounded-md bg-muted border px-3 py-2">
                        <code className="flex-1 text-xs break-all font-mono min-w-0">{walletAddress || 'Loading...'}</code>
                        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => copyToClipboard(walletAddress, 'Wallet address')}><Copy className="size-3.5" /></Button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-pin-50 dark:bg-pin-900/20 p-3 border border-pin-200 dark:border-pin-800">
                      <p className="text-sm font-semibold text-pin-700 dark:text-pin-400">
                        Send exactly: {selectedPlan.priceUsd} USDT
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Network: TRC20 (TRON) • Token: USDT
                      </p>
                      <p className="text-xs text-red-500 mt-1 font-medium">
                        ⚠ Amount must match exactly. Wrong amount = plan will NOT activate.
                      </p>
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="txid-trc20">Transaction ID (TXID)</Label>
                  <Textarea
                    id="txid-trc20"
                    placeholder="Paste your TRC20 transaction hash here..."
                    rows={2}
                    value={txid}
                    onChange={(e) => setTxid(e.target.value)}
                    disabled={verifying || submitting}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    After sending USDT, paste the TXID here. We will automatically verify on Tronscan.
                  </p>
                </div>
                <Button
                  onClick={handleSubmitPayment}
                  disabled={submitting || !txid.trim() || verifying}
                  className="w-full bg-pin-600 hover:bg-pin-700 text-white"
                  size="lg"
                >
                  {submitting || verifying ? (
                    <><Loader2 className="mr-2 size-4 animate-spin" />{verifying ? 'Verifying Payment...' : 'Submitting...'}</>
                  ) : (
                    <><CreditCard className="mr-2 size-4" />Submit & Auto-Verify Payment</>
                  )}
                </Button>
              </>
            )}

            {/* Binance Pay Payment */}
            {paymentMethod === 'binance' && (
              <>
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <div className="rounded-xl border-2 border-yellow-300 dark:border-yellow-600 bg-white p-3 dark:bg-gray-950 shrink-0">
                    {QrCodeComponent ? (
                      <QrCodeComponent
                        value={binancePayId}
                        size={180}
                        level="M"
                        includeMargin={false}
                        fgColor="#000000"
                        bgColor="#ffffff"
                      />
                    ) : (
                      <div className="flex size-[180px] items-center justify-center text-muted-foreground">
                        <Skeleton className="size-full" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-3 text-center sm:text-left min-w-0">
                    <div>
                      <p className="text-sm font-medium">Binance Pay ID</p>
                      <div className="mt-1.5 flex items-center gap-2 rounded-md bg-muted border px-3 py-2">
                        <code className="text-sm font-mono font-semibold">{binancePayId}</code>
                        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => copyToClipboard(binancePayId, 'Pay ID')}><Copy className="size-3.5" /></Button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-3 border border-yellow-200 dark:border-yellow-800">
                      <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">
                        Send exactly: {selectedPlan.priceUsd} USDT
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Open Binance App → Scan QR Code or search Pay ID → Send USDT (Zero Fees)
                      </p>
                      <p className="text-xs text-yellow-600 mt-1 font-medium">
                        ✅ Zero transfer fees with Binance Pay
                      </p>
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="txid-binance">Transaction ID (TXID) or Reference</Label>
                  <Textarea
                    id="txid-binance"
                    placeholder="Paste your Binance transaction ID or reference number here..."
                    rows={2}
                    value={txid}
                    onChange={(e) => setTxid(e.target.value)}
                    disabled={submitting}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    After sending via Binance Pay, paste your TXID here. Our team will manually verify and activate your plan within 24 hours.
                  </p>
                </div>
                <Button
                  onClick={handleSubmitPayment}
                  disabled={submitting || !txid.trim()}
                  className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                  size="lg"
                >
                  {submitting ? (
                    <><Loader2 className="mr-2 size-4 animate-spin" />Submitting...</>
                  ) : (
                    <><CreditCard className="mr-2 size-4" />Submit for Manual Review</>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">TXID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No payment history</TableCell></TableRow>
              ) : (
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="font-medium">{order.plan?.name || order.planId}</TableCell>
                    <TableCell>
                      <Badge variant={order.network === 'Binance' ? 'secondary' : 'outline'} className="text-xs">
                        {order.network === 'Binance' ? '🟡 Binance' : '💳 TRC20'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">${order.expectedAmount}</span>
                    </TableCell>
                    <TableCell><StatusBadge status={order.status} /></TableCell>
                    <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground max-w-[140px] truncate">{order.txid || '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Main Dashboard Component ─────────────────────────────────────────
export function Dashboard() {
  const user = useAppStore((s) => s.user)
  const dashboardTab = useAppStore((s) => s.dashboardTab)
  const setDashboardTab = useAppStore((s) => s.setDashboardTab)
  const setView = useAppStore((s) => s.setView)
  const setUser = useAppStore((s) => s.setUser)
  const selectedConnectionId = useAppStore((s) => s.selectedConnectionId)
  const setSelectedConnectionId = useAppStore((s) => s.setSelectedConnectionId)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const [connections, setConnections] = useState<PinterestConnection[]>([])
  const [loadingConn, setLoadingConn] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const oauthHandled = useRef(false)

  const fetchConnections = useCallback(async () => {
    try {
      const res = await apiFetch('/api/connections')
      const data = await res.json()
      const list = data.connections || []
      setConnections(list)
      if (!selectedConnectionId && list.length > 0) {
        setSelectedConnectionId(list[0].id)
      }
    } catch {}
    finally { setLoadingConn(false) }
  }, [refreshKey, selectedConnectionId, setSelectedConnectionId])

  useEffect(() => { fetchConnections() }, [fetchConnections])

  // ─── Tab persistence across page reloads ──────────────────────────
  // The active tab lives in the URL hash (#tab=accounts) so a browser
  // refresh/restore keeps you on the SAME section instead of kicking you
  // back to Overview. Also makes browser back/forward switch tabs.
  const validTabs = NAV_ITEMS.map((i) => i.key)

  const tabFromHash = useCallback((): DashboardTab | null => {
    if (typeof window === 'undefined') return null
    const raw = window.location.hash.replace(/^#/, '')
    const tab = new URLSearchParams(raw).get('tab') as DashboardTab | null
    return tab && (validTabs as string[]).includes(tab) ? tab : null
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore tab from hash on first mount (page load / refresh)
  useEffect(() => {
    const restore = tabFromHash()
    if (restore && restore !== dashboardTab) setDashboardTab(restore)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep store in sync when the hash changes (back/forward buttons)
  useEffect(() => {
    const onHashChange = () => {
      const tab = tabFromHash()
      if (tab && tab !== useAppStore.getState().dashboardTab) setDashboardTab(tab)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [tabFromHash, setDashboardTab])

  // Handle OAuth callback result from URL params (must be after fetchConnections declaration)
  useEffect(() => {
    if (oauthHandled.current) return
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth_result')
    const authMessage = params.get('auth_message')
    if (!authResult) return
    oauthHandled.current = true
    // Clean OAuth params but KEEP the tab hash so a refresh right after
    // connecting stays on the Accounts section
    window.history.replaceState({}, '', '#tab=accounts')
    if (authResult === 'connected') {
      toast.success(decodeURIComponent(authMessage || 'Account connected!'))
      fetchConnections()
      setDashboardTab('accounts')
    } else if (authResult === 'access_denied') {
      toast.error('Pinterest authorization was denied')
    } else {
      toast.error(decodeURIComponent(authMessage || 'Connection failed'))
    }
  }, [fetchConnections, setDashboardTab])

  const handleLogout = async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }) } catch {}
    clearSession()
    setUser(null)
    setView('landing')
    // Clear the tab hash so a fresh login starts on Overview
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState({}, '', '/')
    }
  }

  const handleTabChange = (tab: typeof NAV_ITEMS[number]['key']) => {
    setDashboardTab(tab)
    // Persist the tab in the URL so a refresh keeps you on this section
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', `#tab=${tab}`)
    }
    setMobileOpen(false)
  }

  const handleAdmin = () => {
    setView('admin')
    // Track the admin view in the hash so a refresh keeps you in the panel
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '#admin=overview')
    }
    setMobileOpen(false)
  }

  const selectedConnection = connections.find((c) => c.id === selectedConnectionId)

  if (!user) return null

  const renderContent = () => {
    switch (dashboardTab) {
      case 'overview': return <OverviewTab connections={connections} />
      case 'accounts': return <AccountsTab connections={connections} mutate={fetchConnections} />
      case 'boards': return <BoardsTab connections={connections} mutate={fetchConnections} />
      case 'create-pin': return <CreatePinTab connections={connections} />
      case 'bulk-upload': return <BulkUploadTab connections={connections} />
      case 'scheduled': return <ScheduledTab connections={connections} />
      case 'analytics': return <AnalyticsTab connections={connections} />
      case 'logs': return <LogsTab connections={connections} />
      case 'plan-payment': return <PlanPaymentTab />
      default: return <OverviewTab connections={connections} />
    }
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r bg-card">
        <SidebarNav
          onSelect={handleTabChange}
          activeTab={dashboardTab}
          user={user}
          onLogout={handleLogout}
          onAdmin={handleAdmin}
        />
      </aside>

      {/* Mobile Sidebar Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader>
            <SheetTitle className="sr-only">Dashboard Navigation</SheetTitle>
          </SheetHeader>
          <SidebarNav
            onSelect={handleTabChange}
            activeTab={dashboardTab}
            user={user}
            onLogout={handleLogout}
            onAdmin={handleAdmin}
          />
        </SheetContent>
      </Sheet>

      {/* Main Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center gap-3 border-b px-4 py-3 bg-card">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </Button>

          <h1 className="text-lg font-semibold flex-1">{TAB_TITLES[dashboardTab] || 'Dashboard'}</h1>

          {/* Account Switcher */}
          {connections.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 max-w-[200px]">
                  <span className="truncate">{selectedConnection?.nickname || selectedConnection?.profileName || 'Select Account'}</span>
                  <ChevronDown className="size-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {connections.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => setSelectedConnectionId(c.id)}
                    className={c.id === selectedConnectionId ? 'bg-accent' : ''}
                  >
                    {c.nickname || c.profileName || c.id.slice(0, 8)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <span className="hidden sm:block text-sm text-muted-foreground max-w-[200px] truncate">{user.email}</span>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6">
            <PlanExpiryBanner onRenew={() => handleTabChange('plan-payment')} />
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  )
}