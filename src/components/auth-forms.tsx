'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAppStore, type UserSession } from '@/store'
import { saveSession } from '@/lib/api'

export function LoginForm() {
  const { showLoginModal, setShowLoginModal, setShowSignupModal, setShowForgotPasswordModal, setUser, setView } =
    useAppStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})

  function validate(): boolean {
    const newErrors: { email?: string; password?: string } = {}
    if (!email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Please enter a valid email'
    }
    if (!password) {
      newErrors.password = 'Password is required'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Login failed')
        return
      }

      const session: UserSession = data.user
      saveSession(session, data.token)
      setUser(session)
      setShowLoginModal(false)

      if (session.role === 'admin' || session.role === 'super_admin') {
        setView('admin')
      } else {
        setView('dashboard')
      }

      toast.success('Welcome back!')
      setEmail('')
      setPassword('')
      setErrors({})
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function switchToSignup() {
    setShowLoginModal(false)
    setShowSignupModal(true)
  }

  return (
    <Dialog open={showLoginModal} onOpenChange={(open) => setShowLoginModal(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome back</DialogTitle>
          <DialogDescription>Sign in to your account to continue</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
              }}
              autoComplete="email"
              disabled={loading}
            />
            {errors.email && (
              <p className="text-destructive text-xs">{errors.email}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password">Password</Label>
              <button
                type="button"
                className="text-primary hover:underline text-xs font-medium"
                onClick={() => {
                  setShowLoginModal(false)
                  setShowForgotPasswordModal(true)
                }}
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="login-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
              }}
              autoComplete="current-password"
              disabled={loading}
            />
            {errors.password && (
              <p className="text-destructive text-xs">{errors.password}</p>
            )}
          </div>

          <Button type="submit" className="mt-1" disabled={loading}>
            {loading && <Loader2 className="animate-spin mr-2 size-4" />}
            Login
          </Button>

          <Separator />

          <p className="text-muted-foreground text-center text-sm">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              className="text-primary hover:underline font-medium"
              onClick={switchToSignup}
            >
              Sign up
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SignupForm() {
  const { showSignupModal, setShowSignupModal, setShowLoginModal, setUser, setView } =
    useAppStore()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{
    name?: string
    email?: string
    password?: string
  }>({})

  function validate(): boolean {
    const newErrors: { name?: string; email?: string; password?: string } = {}
    if (!email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Please enter a valid email'
    }
    if (!password) {
      newErrors.password = 'Password is required'
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim() || null,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Signup failed')
        return
      }

      const session: UserSession = data.user
      saveSession(session, data.token)
      setUser(session)
      setShowSignupModal(false)
      setView('dashboard')

      toast.success('Account created!')
      setName('')
      setEmail('')
      setPassword('')
      setErrors({})
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function switchToLogin() {
    setShowSignupModal(false)
    setShowLoginModal(true)
  }

  return (
    <Dialog open={showSignupModal} onOpenChange={(open) => setShowSignupModal(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create an account</DialogTitle>
          <DialogDescription>Get started with your free account</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="signup-name">
              Name <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="signup-name"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
              }}
              autoComplete="email"
              disabled={loading}
            />
            {errors.email && (
              <p className="text-destructive text-xs">{errors.email}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="signup-password">Password</Label>
            <Input
              id="signup-password"
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (errors.password)
                  setErrors((prev) => ({ ...prev, password: undefined }))
              }}
              autoComplete="new-password"
              disabled={loading}
            />
            <p className="text-muted-foreground text-xs">Must be at least 8 characters</p>
            {errors.password && (
              <p className="text-destructive text-xs">{errors.password}</p>
            )}
          </div>

          <Button type="submit" className="mt-1" disabled={loading}>
            {loading && <Loader2 className="animate-spin mr-2 size-4" />}
            Create Account
          </Button>

          <Separator />

          <p className="text-muted-foreground text-center text-sm">
            Already have an account?{' '}
            <button
              type="button"
              className="text-primary hover:underline font-medium"
              onClick={switchToLogin}
            >
              Login
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ForgotPasswordForm() {
  const { showForgotPasswordModal, setShowForgotPasswordModal, setShowLoginModal } = useAppStore()

  const [step, setStep] = useState<'email' | 'reset'>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; otp?: string; password?: string; confirm?: string }>({})

  function resetLocalState() {
    setStep('email')
    setEmail('')
    setOtp('')
    setNewPassword('')
    setConfirmPassword('')
    setErrors({})
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrors({ email: 'Please enter a valid email' })
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Something went wrong')
        return
      }
      toast.success('If that email is registered, a 6-digit code has been sent to it.')
      setStep('reset')
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: typeof errors = {}
    if (!/^\d{6}$/.test(otp.trim())) newErrors.otp = 'Enter the 6-digit code from your email'
    if (newPassword.length < 6) newErrors.password = 'Password must be at least 6 characters'
    if (newPassword !== confirmPassword) newErrors.confirm = 'Passwords do not match'
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp: otp.trim(), newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Invalid or expired code')
        return
      }
      toast.success('Password reset! You can now log in.')
      resetLocalState()
      setShowForgotPasswordModal(false)
      setShowLoginModal(true)
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={showForgotPasswordModal}
      onOpenChange={(open) => {
        setShowForgotPasswordModal(open)
        if (!open) resetLocalState()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset your password</DialogTitle>
          <DialogDescription>
            {step === 'email'
              ? "Enter your account email and we'll send you a 6-digit code."
              : `Enter the code sent to ${email} and choose a new password.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'email' ? (
          <form onSubmit={handleRequestOtp} className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-email">Email</Label>
              <Input
                id="fp-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
                }}
                autoComplete="email"
                disabled={loading}
              />
              {errors.email && <p className="text-destructive text-xs">{errors.email}</p>}
            </div>
            <Button type="submit" className="mt-1" disabled={loading}>
              {loading && <Loader2 className="animate-spin mr-2 size-4" />}
              Send Code
            </Button>
            <p className="text-muted-foreground text-xs text-center">
              You can request up to 3 codes per day per account.
            </p>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-otp">6-digit code</Label>
              <Input
                id="fp-otp"
                type="text"
                inputMode="numeric"
                placeholder="123456"
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
                  if (errors.otp) setErrors((prev) => ({ ...prev, otp: undefined }))
                }}
                disabled={loading}
                className="text-center tracking-[0.3em] text-lg font-semibold"
              />
              {errors.otp && <p className="text-destructive text-xs">{errors.otp}</p>}
              <p className="text-muted-foreground text-xs">Code expires in 10 minutes.</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-new-password">New password</Label>
              <Input
                id="fp-new-password"
                type="password"
                placeholder="Enter a new password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
                }}
                autoComplete="new-password"
                disabled={loading}
              />
              {errors.password && <p className="text-destructive text-xs">{errors.password}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-confirm-password">Confirm new password</Label>
              <Input
                id="fp-confirm-password"
                type="password"
                placeholder="Re-enter the new password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value)
                  if (errors.confirm) setErrors((prev) => ({ ...prev, confirm: undefined }))
                }}
                autoComplete="new-password"
                disabled={loading}
              />
              {errors.confirm && <p className="text-destructive text-xs">{errors.confirm}</p>}
            </div>

            <Button type="submit" className="mt-1" disabled={loading}>
              {loading && <Loader2 className="animate-spin mr-2 size-4" />}
              Reset Password
            </Button>

            <button
              type="button"
              className="text-primary hover:underline text-xs font-medium text-center"
              onClick={() => setStep('email')}
              disabled={loading}
            >
              Didn&apos;t get a code? Send again
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function AuthForms() {
  return (
    <>
      <LoginForm />
      <SignupForm />
      <ForgotPasswordForm />
    </>
  )
}
