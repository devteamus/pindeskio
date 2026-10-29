'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Package,
  ArrowLeft,
  LogOut,
  Search,
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  UserCog,
  Loader2,
  Shield,
  Link2,
  Pin,
  AlertTriangle,
  DollarSign,
  Clock,
  Ban,
  UserCheck,
  Menu,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useAppStore, type PaymentOrder, type Plan } from '@/store'
import { apiFetch, clearSession } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

type AdminUserStatus = 'all' | 'active' | 'pending' | 'suspended'
type PaymentFilterStatus = 'all' | 'pending' | 'submitted' | 'verifying' | 'verified' | 'rejected' | 'failed_verification'

interface AdminUser {
  id: string
  email: string
  name: string | null
  status: string
  currentPlanId: string | null
  createdAt: string
  _count?: {
    connections: number
    paymentOrders: number
  }
  currentPlan?: { name: string }
}

interface AdminStats {
  totalUsers: number
  activeUsers: number
  pendingUsers: number
  suspendedUsers: number
  totalConnections: number
  totalPins: number
  publishedPins: number
  failedPins: number
  totalRevenue: number
  pendingPayments: number
}

// ─── Status Badge ───────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = status?.toLowerCase() ?? ''
  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'secondary'
  let className = ''
  if (['active', 'verified', 'published'].includes(s)) {
    variant = 'default'
    className = 'bg-pin-100 text-pin-700 dark:bg-pin-900/40 dark:text-pin-400 hover:bg-pin-100 dark:hover:bg-pin-900/40'
  } else if (['pending', 'submitted', 'scheduled', 'pending_approval'].includes(s)) {
    variant = 'secondary'
    className = 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40'
  } else if (['suspended', 'rejected', 'failed', 'disabled', 'canceled', 'failed_verification'].includes(s)) {
    variant = 'destructive'
    className = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40'
  } else if (['canceled', 'cancelled'].includes(s)) {
    variant = 'outline'
    className = 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
  }
  return (
    <Badge variant={variant} className={className}>
      {status}
    </Badge>
  )
}

// ─── Sidebar Nav Item ───────────────────────────────────────
function SidebarNavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-pin-100 text-pin-700 dark:bg-pin-900/30 dark:text-pin-400'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

// ─── Stat Card (compact for mobile) ─────────────────────────
function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; color: string }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg sm:h-12 sm:w-12 ${color}`}>
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold tracking-tight sm:text-2xl truncate">{value}</p>
            <p className="text-xs text-muted-foreground sm:text-sm truncate">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Overview Tab ───────────────────────────────────────────
function OverviewTab() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchStats() {
      try {
        const res = await apiFetch('/api/admin/stats')
        if (!res.ok) throw new Error('Failed to fetch stats')
        const data = await res.json()
        if (!cancelled) setStats(data)
      } catch {
        toast.error('Failed to load admin stats')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchStats()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <Skeleton className="h-10 w-10 rounded-lg sm:h-12 sm:w-12" />
                <div className="space-y-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!stats) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Unable to load statistics. Please try again.</AlertDescription>
      </Alert>
    )
  }

  const cards = [
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'text-pin-600 bg-pin-100 dark:bg-pin-900/30 dark:text-pin-400' },
    { label: 'Active Users', value: stats.activeUsers, icon: UserCheck, color: 'text-pin-600 bg-pin-100 dark:bg-pin-900/30 dark:text-pin-400' },
    { label: 'Pending Approvals', value: stats.pendingUsers, icon: Clock, color: stats.pendingUsers > 0 ? 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400' : 'text-muted-foreground bg-muted' },
    { label: 'Suspended Users', value: stats.suspendedUsers, icon: Ban, color: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400' },
    { label: 'Connections', value: stats.totalConnections, icon: Link2, color: 'text-rose-600 bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400' },
    { label: 'Published Pins', value: stats.publishedPins, icon: Pin, color: 'text-pin-600 bg-pin-100 dark:bg-pin-900/30 dark:text-pin-400' },
    { label: 'Failed Pins', value: stats.failedPins, icon: AlertTriangle, color: stats.failedPins > 0 ? 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400' : 'text-muted-foreground bg-muted' },
    { label: 'Total Revenue', value: `$${stats.totalRevenue}`, icon: DollarSign, color: 'text-pin-600 bg-pin-100 dark:bg-pin-900/30 dark:text-pin-400' },
  ]

  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <StatCard key={card.label} label={card.label} value={card.value} icon={card.icon} color={card.color} />
      ))}
    </div>
  )
}

// ─── Users Tab ──────────────────────────────────────────────
function UsersTab() {
  const { triggerRefresh, refreshKey } = useAppStore()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus>('all')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Plan change dialog
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [planDialogUser, setPlanDialogUser] = useState<AdminUser | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [planChanging, setPlanChanging] = useState(false)

  const limit = 20
  const totalPages = Math.ceil(total / limit)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      const res = await apiFetch(`/api/admin/users?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setUsers(data.users ?? [])
      setTotal(data.total ?? 0)
    } catch {
      toast.error('Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, search])

  const fetchPlans = useCallback(async () => {
    try {
      const res = await apiFetch('/api/plans')
      if (!res.ok) return
      const data = await res.json()
      setPlans(data.plans ?? [])
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers, refreshKey])

  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  const handleAction = async (userId: string, action: string, planId?: string) => {
    setActionLoading(userId)
    try {
      const body: Record<string, unknown> = { userId, action }
      if (planId) body.planId = planId
      const res = await apiFetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Action failed')
      }
      toast.success(`User ${action === 'approve' ? 'approved' : action === 'disable' ? 'disabled' : action === 'enable' ? 'enabled' : 'plan changed'}`)
      triggerRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  const openPlanDialog = (user: AdminUser) => {
    setPlanDialogUser(user)
    setSelectedPlanId(user.currentPlanId ?? '')
    setPlanDialogOpen(true)
  }

  const handlePlanChange = async () => {
    if (!planDialogUser || !selectedPlanId) return
    setPlanChanging(true)
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: planDialogUser.id, action: 'change_plan', planId: selectedPlanId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to change plan')
      }
      toast.success('Plan updated successfully')
      setPlanDialogOpen(false)
      triggerRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change plan')
    } finally {
      setPlanChanging(false)
    }
  }

  // ─── Mobile User Card ─────────────────────────────────────
  const UserMobileCard = ({ u }: { u: AdminUser }) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{u.email}</p>
            {u.name && <p className="text-xs text-muted-foreground mt-0.5 truncate">{u.name}</p>}
          </div>
          <StatusBadge status={u.status} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-muted/50 py-1.5 px-1">
            <p className="text-xs text-muted-foreground">Plan</p>
            <p className="text-sm font-medium mt-0.5 truncate">{u.currentPlan?.name || 'Free'}</p>
          </div>
          <div className="rounded-md bg-muted/50 py-1.5 px-1">
            <p className="text-xs text-muted-foreground">Accounts</p>
            <p className="text-sm font-medium mt-0.5">{u._count?.connections ?? 0}</p>
          </div>
          <div className="rounded-md bg-muted/50 py-1.5 px-1">
            <p className="text-xs text-muted-foreground">Payments</p>
            <p className="text-sm font-medium mt-0.5">{u._count?.paymentOrders ?? 0}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Joined {new Date(u.createdAt).toLocaleDateString()}
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {u.status === 'pending' && (
                <DropdownMenuItem
                  onClick={() => handleAction(u.id, 'approve')}
                  disabled={actionLoading === u.id}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4 text-pin-600" />
                  Approve
                </DropdownMenuItem>
              )}
              {u.status === 'suspended' || u.status === 'disabled' ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={actionLoading === u.id}>
                      <UserCheck className="mr-2 h-4 w-4 text-pin-600" />
                      Enable
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Enable User</AlertDialogTitle>
                      <AlertDialogDescription>Are you sure you want to enable {u.email}?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleAction(u.id, 'enable')}>Enable</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={actionLoading === u.id}>
                      <XCircle className="mr-2 h-4 w-4 text-red-600" />
                      Disable
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disable User</AlertDialogTitle>
                      <AlertDialogDescription>Are you sure you want to disable {u.email}?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleAction(u.id, 'disable')} className="bg-red-600 hover:bg-red-700">
                        Disable
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <DropdownMenuItem onClick={() => openPlanDialog(u)}>
                <UserCog className="mr-2 h-4 w-4" />
                Change Plan
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as AdminUserStatus); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-3 md:hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-24 w-full rounded-lg" /></CardContent></Card>
          ))}
        </div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="mx-auto h-10 w-10 mb-2 opacity-30" />
            <p>No users found</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: Card Layout */}
          <div className="space-y-3 md:hidden">
            {users.map((u) => (
              <UserMobileCard key={u.id} u={u} />
            ))}
          </div>

          {/* Desktop: Table Layout */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Email</TableHead>
                      <TableHead className="min-w-[120px]">Name</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Connections</TableHead>
                      <TableHead className="text-center">Payments</TableHead>
                      <TableHead className="min-w-[100px]">Joined</TableHead>
                      <TableHead className="w-[60px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.email}</TableCell>
                        <TableCell>{u.name || '—'}</TableCell>
                        <TableCell>{u.currentPlan?.name || 'Free'}</TableCell>
                        <TableCell><StatusBadge status={u.status} /></TableCell>
                        <TableCell className="text-center">{u._count?.connections ?? 0}</TableCell>
                        <TableCell className="text-center">{u._count?.paymentOrders ?? 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {u.status === 'pending' && (
                                <DropdownMenuItem
                                  onClick={() => handleAction(u.id, 'approve')}
                                  disabled={actionLoading === u.id}
                                >
                                  <CheckCircle2 className="mr-2 h-4 w-4 text-pin-600" />
                                  Approve
                                </DropdownMenuItem>
                              )}
                              {u.status === 'suspended' || u.status === 'disabled' ? (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={actionLoading === u.id}>
                                      <UserCheck className="mr-2 h-4 w-4 text-pin-600" />
                                      Enable
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Enable User</AlertDialogTitle>
                                      <AlertDialogDescription>Are you sure you want to enable {u.email}? They will regain access to their account.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleAction(u.id, 'enable')}>Enable</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              ) : (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={actionLoading === u.id}>
                                      <XCircle className="mr-2 h-4 w-4 text-red-600" />
                                      Disable
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Disable User</AlertDialogTitle>
                                      <AlertDialogDescription>Are you sure you want to disable {u.email}? They will lose access to their account immediately.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleAction(u.id, 'disable')} className="bg-red-600 hover:bg-red-700">
                                        Disable
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                              <DropdownMenuItem onClick={() => openPlanDialog(u)}>
                                <UserCog className="mr-2 h-4 w-4" />
                                Change Plan
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground sm:text-sm">
            {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <span className="text-xs text-muted-foreground sm:text-sm">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Plan Change Dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Plan</DialogTitle>
            <DialogDescription>Change plan for {planDialogUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="plan-select">Select Plan</Label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger id="plan-select">
                <SelectValue placeholder="Choose a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {p.priceUsd ? `$${p.priceUsd}` : 'Free'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>Cancel</Button>
            <Button onClick={handlePlanChange} disabled={!selectedPlanId || planChanging}>
              {planChanging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Payments Tab ───────────────────────────────────────────
function PaymentsTab() {
  const { triggerRefresh, refreshKey } = useAppStore()
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<PaymentFilterStatus>('all')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Verify dialog
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false)
  const [verifyOrder, setVerifyOrder] = useState<PaymentOrder | null>(null)
  const [verifyNotes, setVerifyNotes] = useState('')
  const [verifying, setVerifying] = useState(false)

  // Reject dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectOrder, setRejectOrder] = useState<PaymentOrder | null>(null)
  const [rejectNotes, setRejectNotes] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const limit = 20
  const totalPages = Math.ceil(total / limit)

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await apiFetch(`/api/admin/payments?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setOrders(data.orders ?? [])
      setTotal(data.total ?? 0)
    } catch {
      toast.error('Failed to load payments')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => {
    fetchPayments()
  }, [fetchPayments, refreshKey])

  const handlePaymentAction = async (orderId: string, action: 'verify' | 'reject', adminNotes?: string) => {
    setActionLoading(orderId)
    try {
      const res = await apiFetch('/api/admin/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, action, adminNotes }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Action failed')
      }
      toast.success(`Payment ${action === 'verify' ? 'verified' : 'rejected'}`)
      setVerifyDialogOpen(false)
      setRejectDialogOpen(false)
      triggerRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  const openVerifyDialog = (order: PaymentOrder) => {
    setVerifyOrder(order)
    setVerifyNotes('')
    setVerifyDialogOpen(true)
  }

  const openRejectDialog = (order: PaymentOrder) => {
    setRejectOrder(order)
    setRejectNotes('')
    setRejectDialogOpen(true)
  }

  // ─── Mobile Payment Card ──────────────────────────────────
  const PaymentMobileCard = ({ order }: { order: PaymentOrder }) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{order.user?.email ?? '—'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{order.plan?.name ?? '—'}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-md bg-muted/50 py-2 px-2">
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-sm font-semibold">${order.amount}</p>
          </div>
          <div className="rounded-md bg-muted/50 py-2 px-2">
            <p className="text-xs text-muted-foreground">Date</p>
            <p className="text-sm">{new Date(order.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        {order.txid && (
          <div className="mt-2 rounded-md bg-muted/30 p-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">TXID</p>
            <p className="text-xs font-mono text-muted-foreground mt-0.5 break-all">{order.txid}</p>
          </div>
        )}
        {(order.status === 'pending' || order.status === 'submitted' || order.status === 'failed_verification') && (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" className="flex-1 bg-pin-600 hover:bg-pin-700" onClick={() => openVerifyDialog(order)} disabled={actionLoading === order.id}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Verify
            </Button>
            <Button size="sm" variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50" onClick={() => openRejectDialog(order)} disabled={actionLoading === order.id}>
              <XCircle className="mr-1 h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as PaymentFilterStatus); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="verifying">Verifying</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="failed_verification">Failed Verification</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-3 md:hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-32 w-full rounded-lg" /></CardContent></Card>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CreditCard className="mx-auto h-10 w-10 mb-2 opacity-30" />
            <p>No payments found</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: Card Layout */}
          <div className="space-y-3 md:hidden">
            {orders.map((order) => (
              <PaymentMobileCard key={order.id} order={order} />
            ))}
          </div>

          {/* Desktop: Table Layout */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="min-w-[200px]">User Email</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead className="min-w-[140px]">TXID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-medium">{order.user?.email ?? '—'}</TableCell>
                        <TableCell>{order.plan?.name ?? '—'}</TableCell>
                        <TableCell className="font-semibold">${order.amount}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">${order.expectedAmount ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                          {order.txid ? (
                            <span title={order.txid}>{order.txid}</span>
                          ) : (
                            <span className="text-gray-400">No TXID</span>
                          )}
                        </TableCell>
                        <TableCell><StatusBadge status={order.status} /></TableCell>
                        <TableCell>
                          {(order.status === 'pending' || order.status === 'submitted' || order.status === 'failed_verification') ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">Actions</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openVerifyDialog(order)}>
                                  <CheckCircle2 className="mr-2 h-4 w-4 text-pin-600" />
                                  Verify
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openRejectDialog(order)} className="text-red-600 focus:text-red-600">
                                  <XCircle className="mr-2 h-4 w-4" />
                                  Reject
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            (order as PaymentOrder & { adminNotes?: string | null }).adminNotes ? (
                              <span className="text-xs text-muted-foreground" title={(order as PaymentOrder & { adminNotes?: string | null }).adminNotes ?? ''}>
                                Has notes
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground sm:text-sm">
            {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <span className="text-xs text-muted-foreground sm:text-sm">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Verify Dialog */}
      <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Verify Payment</DialogTitle>
            <DialogDescription>
              Verify payment of {verifyOrder?.amount} USDT from {verifyOrder?.user?.email} for {verifyOrder?.plan?.name}.
              {verifyOrder?.txid && (
                <span className="block mt-2 font-mono text-xs bg-muted p-2 rounded break-all">
                  TXID: {verifyOrder.txid}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="verify-notes">Admin Notes (optional)</Label>
            <Textarea id="verify-notes" placeholder="Add any notes about this verification..." value={verifyNotes} onChange={(e) => setVerifyNotes(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyDialogOpen(false)}>Cancel</Button>
            <Button className="bg-pin-600 hover:bg-pin-700" onClick={() => handlePaymentAction(verifyOrder!.id, 'verify', verifyNotes || undefined)} disabled={!verifyOrder || verifying}>
              {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Payment</DialogTitle>
            <DialogDescription>
              Reject payment of {rejectOrder?.amount} USDT from {rejectOrder?.user?.email}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="reject-notes">Rejection Reason</Label>
            <Textarea id="reject-notes" placeholder="Please provide a reason for rejection..." value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => handlePaymentAction(rejectOrder!.id, 'reject', rejectNotes || undefined)} disabled={!rejectOrder || rejecting}>
              {rejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Plans Tab ──────────────────────────────────────────────
function PlansTab() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchPlans() {
      try {
        const res = await apiFetch('/api/plans')
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        if (!cancelled) setPlans(data.plans ?? [])
      } catch {
        toast.error('Failed to load plans')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchPlans()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (plans.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Package className="mx-auto h-10 w-10 mb-2 opacity-30" />
          No plans configured
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan) => {
        // Features are stored as a JSON string array; parse safely so a
        // legacy/invalid value can never crash the whole Plans tab.
        let features: string[] = []
        if (plan.features) {
          try {
            const parsed = JSON.parse(plan.features)
            if (Array.isArray(parsed)) features = parsed.filter((f) => typeof f === 'string')
          } catch {
            features = plan.features.split(',').map((f) => f.trim()).filter(Boolean)
          }
        }
        return (
          <Card key={plan.id} className="relative">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{plan.name}</CardTitle>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold sm:text-3xl">
                  {plan.priceUsd ? `$${plan.priceUsd}` : 'Free'}
                </span>
                {plan.priceUsd && (
                  <span className="text-sm text-muted-foreground">/month</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Accounts</span>
                  <span className="font-medium">{plan.maxConnectedAccounts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monthly Quota</span>
                  <span className="font-medium">{plan.monthlyPinQuota} pins</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Rows / Import</span>
                  <span className="font-medium">{plan.maxRowsPerImport}</span>
                </div>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">Features</p>
                <ul className="space-y-1">
                  {features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-pin-600" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Main Admin Panel ───────────────────────────────────────
const ADMIN_NAV_KEYS = ['overview', 'users', 'payments', 'plans']

export function AdminPanel() {
  const { user, adminTab, setAdminTab, setView, setUser } = useAppStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // ─── Admin tab persistence across reloads (#admin=users) ───────────
  const adminTabFromHash = (): string | null => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const t = params.get('admin')
    return t && ADMIN_NAV_KEYS.includes(t) ? t : null
  }

  // Restore admin tab from hash on mount (page load / refresh)
  useEffect(() => {
    const restore = adminTabFromHash()
    if (restore && restore !== useAppStore.getState().adminTab) setAdminTab(restore as 'overview')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep store in sync when the hash changes (back/forward buttons)
  useEffect(() => {
    const onHashChange = () => {
      const t = adminTabFromHash()
      if (t && t !== useAppStore.getState().adminTab) setAdminTab(t as 'overview')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }) } catch {}
    clearSession()
    setUser(null)
    setView('landing')
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState({}, '', '/')
    }
  }

  const handleBackToDashboard = () => {
    setView('dashboard')
    // Switch the hash to the dashboard view so a refresh stays there
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '#tab=overview')
    }
  }

  const navItems = [
    { key: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { key: 'users' as const, label: 'Users', icon: Users },
    { key: 'payments' as const, label: 'Payments', icon: CreditCard },
    { key: 'plans' as const, label: 'Plans', icon: Package },
  ]

  const pageTitle = navItems.find((n) => n.key === adminTab)?.label ?? 'Overview'

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pin-600">
          <Shield className="h-4 w-4 text-white" />
        </div>
        <span className="text-lg font-bold tracking-tight">Pin Desk Admin</span>
      </div>

      <Separator />

      {/* Nav */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {navItems.map((item) => (
            <SidebarNavItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={adminTab === item.key}
              onClick={() => {
                setAdminTab(item.key)
                // Persist the admin tab in the URL so a refresh keeps it
                if (typeof window !== 'undefined') {
                  window.history.pushState({}, '', `#admin=${item.key}`)
                }
                setSidebarOpen(false)
              }}
            />
          ))}
        </nav>

        <Separator className="my-4" />

        <button
          onClick={handleBackToDashboard}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>
      </ScrollArea>

      <Separator />

      {/* Logout */}
      <div className="px-3 py-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-white dark:bg-slate-900 lg:flex lg:flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 p-0">
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-12 items-center gap-3 border-b bg-white px-3 sm:h-14 sm:px-4 lg:h-14 lg:px-6 dark:bg-slate-900">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle sidebar</span>
          </Button>
          <h1 className="text-base font-semibold truncate sm:text-lg">{pageTitle}</h1>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 sm:text-sm sm:gap-2">
            <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-pin-600" />
            <span className="hidden sm:inline truncate max-w-[200px]">{user?.email}</span>
            <span className="sm:hidden">Admin</span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          {adminTab === 'overview' && <OverviewTab />}
          {adminTab === 'users' && <UsersTab />}
          {adminTab === 'payments' && <PaymentsTab />}
          {adminTab === 'plans' && <PlansTab />}
        </main>
      </div>
    </div>
  )
}
