import { Link, Navigate, Outlet } from 'react-router-dom';
import { ArrowLeft, Bot, MapPin, ShieldCheck, Truck } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { SaarthiWordmark } from '@/components/common/logo';
import { LoadingState } from '@/components/common/states';
import { Stagger, StaggerItem, motion } from '@/components/motion';

const HIGHLIGHTS = [
  {
    icon: Truck,
    title: 'One fleet command centre',
    body: 'Trucks, drivers, documents, orders and trips in a single operational view.',
  },
  {
    icon: MapPin,
    title: 'Live tracking that actually moves',
    body: 'Realtime positions, ETAs and route deviation alerts as they happen.',
  },
  {
    icon: ShieldCheck,
    title: 'Driver safety network',
    body: 'One-tap SOS reaches nearby Saarthi trucks in expanding rings.',
  },
  {
    icon: Bot,
    title: 'AI grounded in your data',
    body: 'Answers built only from records your role is allowed to see.',
  },
];

export function AuthLayout() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <LoadingState label="Loading Saarthi…" className="min-h-screen" />;
  }
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="grid grid-cols-1 min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      {/* Brand panel — hidden on small screens so the form gets the space. */}
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 70% 60%, white 1px, transparent 1px)',
            backgroundSize: '48px 48px, 64px 64px',
          }}
          aria-hidden
        />

        {/* Ambient colour for the glass tiles to refract. */}
        <div
          className="pointer-events-none absolute -left-32 top-1/4 size-[32rem] rounded-full bg-primary/30 blur-[130px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-40 right-0 size-[26rem] rounded-full bg-accent/20 blur-[120px]"
          aria-hidden
        />

        <div className="relative">
          <Link to="/" className="inline-block">
            <SaarthiWordmark className="[&_p:first-child]:text-sidebar-foreground [&_p:last-child]:text-sidebar-muted" />
          </Link>
        </div>

        <Stagger className="relative max-w-md space-y-8">
          <StaggerItem className="space-y-3">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight text-sidebar-foreground">
              The operating system for your trucking business.
            </h2>
            <p className="text-sm leading-relaxed text-sidebar-muted">
              Saarthi connects fleet owners, drivers, suppliers and customers on one platform —
              from posting a load to watching it arrive.
            </p>
          </StaggerItem>

          <ul className="space-y-3">
            {HIGHLIGHTS.map((highlight) => (
              <StaggerItem
                as="li"
                key={highlight.title}
                className="glass-sheen relative flex gap-3.5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-md"
              >
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <highlight.icon className="size-4.5 text-accent" />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-sidebar-foreground">{highlight.title}</p>
                  <p className="text-xs leading-relaxed text-sidebar-muted">{highlight.body}</p>
                </div>
              </StaggerItem>
            ))}
          </ul>
        </Stagger>

        <p className="relative text-2xs text-sidebar-muted">
          Local development build — simulated GPS, mock payments, local document storage.
        </p>
      </aside>

      <main className="relative flex items-center justify-center overflow-hidden bg-background px-5 py-10 sm:px-10">
        <div className="glass-backdrop" aria-hidden />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-sm space-y-8"
        >
          <div className="flex items-center justify-between lg:hidden">
            <SaarthiWordmark />
          </div>
          <Link
            to="/"
            className="hidden items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
          >
            <ArrowLeft className="size-3.5" />
            Back to saarthi.com
          </Link>
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
