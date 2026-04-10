import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, LogIn, Package2, ScanLine, ShieldCheck, Warehouse } from 'lucide-react';
import { useAuth } from './AuthProvider';
import type { LoginCredentials } from '@/types';

export function LoginPage() {
  const { login, isLoading, error } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginCredentials>();

  const onSubmit = async (data: LoginCredentials) => {
    try {
      await login(data);
    } catch {
      // Error is handled by AuthProvider.
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-7xl gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,30rem)]">
        <section className="hero-surface hidden min-h-[38rem] p-8 lg:flex lg:flex-col lg:justify-between xl:p-12">
          <div className="relative z-10 max-w-xl">
            <p className="page-kicker">Retail command desk</p>
            <h1 className="mt-4 max-w-lg font-display text-6xl leading-[0.92] text-balance text-secondary-950">
              Move sales, stock, and receiving from one calm console.
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-secondary-600">
              Open Yojob is built for operators who need checkout speed, stock visibility, and
              dependable control over purchasing and inventory flow.
            </p>
          </div>

          <div className="relative z-10 grid gap-4 xl:grid-cols-3">
            <div className="metric-tile">
              <ScanLine className="h-5 w-5 text-primary-600" />
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-secondary-500">
                Checkout
              </p>
              <p className="mt-2 text-lg font-semibold text-secondary-950">Barcode-first POS rhythm</p>
            </div>
            <div className="metric-tile">
              <Warehouse className="h-5 w-5 text-warning-700" />
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-secondary-500">
                Inventory
              </p>
              <p className="mt-2 text-lg font-semibold text-secondary-950">Live stock pressure and receiving</p>
            </div>
            <div className="metric-tile">
              <ShieldCheck className="h-5 w-5 text-success-700" />
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-secondary-500">
                Control
              </p>
              <p className="mt-2 text-lg font-semibold text-secondary-950">Tenant-safe operation across sites</p>
            </div>
          </div>
        </section>

        <section className="shell-panel flex min-h-[38rem] flex-col justify-between px-6 py-8 sm:px-8 lg:min-h-full lg:px-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-primary text-primary-foreground shadow-[0_18px_40px_-24px_color-mix(in_oklch,var(--primary)_70%,transparent)]">
                <Package2 className="h-6 w-6" />
              </div>
              <div>
                <p className="page-kicker text-[0.62rem] tracking-[0.24em]">Open Yojob</p>
                <h2 className="font-display text-3xl text-secondary-950">Sign in to continue</h2>
              </div>
            </div>

            <p className="mt-6 max-w-sm text-sm leading-6 text-secondary-600">
              Use your workstation credentials to access sales, inventory, purchasing, and
              configuration for the active tenant.
            </p>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)}>
              {error && (
                <div className="rounded-[20px] border border-danger-500/20 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="label">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="input"
                  placeholder="admin@localhost"
                  {...register('email', {
                    required: 'Email is required',
                    pattern: {
                      value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+(\.[A-Z]{2,})?$/i,
                      message: 'Invalid email address',
                    },
                  })}
                />
                {errors.email && <p className="text-sm text-danger-600">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="label">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="input pr-11"
                    placeholder="••••••••"
                    {...register('password', {
                      required: 'Password is required',
                      minLength: {
                        value: 6,
                        message: 'Password must be at least 6 characters',
                      },
                    })}
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-icon absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2"
                    onClick={() => setShowPassword(current => !current)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-danger-600">{errors.password.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary h-12 w-full justify-center"
              >
                {isLoading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Signing in
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Enter workspace
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4 border-t border-line/70 pt-5 text-xs text-secondary-500">
            <span>Built for daily retail operations</span>
            <span>Open Yojob © {new Date().getFullYear()}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
