import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  FileCheck2,
  LifeBuoy,
  Menu,
  Package,
  Radio,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Zap,
} from 'lucide-react';
import { PLAN_CATALOGUE, VEHICLE_TOPUP, formatCurrency } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { SaarthiLogo } from '@/components/common/logo';
import { useTheme } from '@/features/theme/theme-context';
import {
  AnimatedNumber,
  RevealOnScroll,
  Stagger,
  StaggerItem,
  motion,
} from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * Public marketing site.
 *
 * Positioned around the thing that actually differentiates Saarthi: it is one
 * system for every party in a haul — fleet, driver, supplier and customer —
 * rather than a tracker bolted onto a spreadsheet. Every claim below maps to a
 * capability that exists in the product.
 */

const NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'How it works', href: '#how' },
  { label: 'For everyone', href: '#roles' },
  { label: 'Pricing', href: '#pricing' },
];

const CAPABILITIES = [
  {
    icon: Radio,
    title: 'Live tracking that moves',
    body: 'Realtime positions, ETAs and route-deviation alerts over WebSockets. The same pipeline serves the simulator today and GPS hardware tomorrow.',
    accent: 'from-primary/20 to-primary/5',
  },
  {
    icon: Package,
    title: 'A marketplace, not a mailbox',
    body: 'Customers post loads, verified fleets quote them, and accepting a quote creates the trip automatically. No phone tag.',
    accent: 'from-accent/20 to-accent/5',
  },
  {
    icon: FileCheck2,
    title: 'Documents that chase themselves',
    body: 'Versioned uploads, verification workflow, and an expiry engine that warns you at 30, 15 and 7 days before a permit lapses.',
    accent: 'from-info/20 to-info/5',
  },
  {
    icon: LifeBuoy,
    title: 'A safety network, not a button',
    body: 'One tap reaches nearby Saarthi trucks in expanding rings until someone answers. Never gated behind a plan.',
    accent: 'from-destructive/20 to-destructive/5',
  },
  {
    icon: ShieldCheck,
    title: 'Scores drivers can argue with',
    body: 'Every point gained or lost carries a written reason and a source record. No black box deciding someone’s livelihood.',
    accent: 'from-success/20 to-success/5',
  },
  {
    icon: Bot,
    title: 'AI grounded in your data',
    body: 'Ask what needs attention today. Answers are built only from records your role can already open, and cite them.',
    accent: 'from-chart-4/20 to-chart-4/5',
  },
];

const STEPS = [
  {
    step: '01',
    title: 'Post what needs moving',
    body: 'A customer names the material, quantity, pickup and delivery. Saarthi ranks the transport that can actually do it.',
  },
  {
    step: '02',
    title: 'Fleets compete for it',
    body: 'Verified operators quote with a specific truck and driver. Compare price, ETA, capacity and driver score side by side.',
  },
  {
    step: '03',
    title: 'Accept, and the trip exists',
    body: 'One click creates the trip, assigns the vehicle, reserves the stock and notifies the driver. Nothing is retyped.',
  },
  {
    step: '04',
    title: 'Watch it arrive',
    body: 'Live position, live ETA, delay alerts, proof of delivery — and a driver score that updates from what actually happened.',
  },
];

const ROLES = [
  {
    icon: Truck,
    role: 'Fleet owners',
    line: '“I know what is happening across my entire operation.”',
    points: ['One command centre', 'Utilisation and profit per truck', 'Document compliance at a glance'],
  },
  {
    icon: Users,
    role: 'Drivers',
    line: '“I am not alone on the road.”',
    points: ['One-tap SOS', 'Nearby fuel, food and workshops', 'A career profile that travels with you'],
  },
  {
    icon: Package,
    role: 'Suppliers',
    line: '“I manage material and transport in one place.”',
    points: ['Live catalogue and pricing', 'Orders straight from customers', 'Dispatch you can follow'],
  },
  {
    icon: BarChart3,
    role: 'Customers',
    line: '“I know where my order and truck are.”',
    points: ['Compare real quotes', 'Track the actual vehicle', 'Rate what you received'],
  },
];

const PROOF_POINTS = [
  { value: 20, suffix: '+', label: 'Operational modules' },
  { value: 148, suffix: '', label: 'API endpoints' },
  { value: 110, suffix: '', label: 'Automated tests' },
  { value: 100, suffix: '%', label: 'Server-enforced access' },
];

function MarketingNav() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="glass sticky top-0 z-50 rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <SaarthiLogo className="h-8" />
          <span className="text-lg font-semibold tracking-tight">VorldX Saarthi</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            className="hidden sm:inline-flex"
          >
            <Sparkles className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button variant="gradient" size="sm" asChild>
            <Link to="/register">
              Start free
              <ArrowRight className="size-4" />
            </Link>
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <nav className="flex flex-col gap-1 p-5 pt-14">
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="rounded-lg px-3 py-2.5 text-sm hover:bg-secondary"
                  >
                    {link.label}
                  </a>
                ))}
                <Link to="/login" className="rounded-lg px-3 py-2.5 text-sm hover:bg-secondary">
                  Sign in
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:pt-24">
      {/* Ambient light the glass panels refract. */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute -left-32 -top-32 size-[38rem] rounded-full bg-primary/25 blur-[130px]" />
        <div className="absolute -right-24 top-24 size-[32rem] rounded-full bg-accent/20 blur-[130px]" />
        <div className="absolute inset-0 bg-grid-subtle bg-grid opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      <div className="mx-auto max-w-5xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <Badge variant="accent" className="mb-6 gap-1.5 px-3 py-1.5">
            <Zap className="size-3" />
            Fleet, marketplace, safety and AI in one platform
          </Badge>
        </motion.div>

        <motion.h1
          className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-6xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        >
          The operating system for
          <br />
          <span className="gradient-text">your trucking business</span>
        </motion.h1>

        <motion.p
          className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
        >
          Stop running a fleet across phone calls, WhatsApp groups and paper registers. Saarthi puts
          owners, drivers, suppliers and customers on one system — from posting a load to watching it
          arrive.
        </motion.p>

        <motion.div
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <Button size="xl" variant="gradient" asChild className="w-full sm:w-auto">
            <Link to="/register">
              Start free — no card needed
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button size="xl" variant="outline" asChild className="w-full sm:w-auto">
            <Link to="/login">See the live demo</Link>
          </Button>
        </motion.div>

        <motion.p
          className="mt-4 text-xs text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          30-day trial on every paid feature · Your data stays yours · Cancel any time
        </motion.p>
      </div>

      {/* Product preview — a stylised command centre rather than a screenshot,
          so it stays truthful as the UI evolves. */}
      <motion.div
        className="mx-auto mt-16 max-w-5xl"
        initial={{ opacity: 0, y: 40, rotateX: 8 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.9, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: 1200 }}
      >
        <Card variant="glass" className="overflow-hidden p-0 shadow-overlay">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <span className="size-2.5 rounded-full bg-destructive/60" />
            <span className="size-2.5 rounded-full bg-warning/60" />
            <span className="size-2.5 rounded-full bg-success/60" />
            <span className="ml-3 text-xs text-muted-foreground">Fleet command centre</span>
            <span className="ml-auto flex items-center gap-1.5 text-2xs text-success">
              <span className="live-dot" />
              Live
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
            {[
              { label: 'Fleet', value: '8 trucks', tone: 'text-foreground' },
              { label: 'On trip', value: '3 moving', tone: 'text-primary' },
              { label: 'Utilisation', value: '62%', tone: 'text-success' },
              { label: 'Needs attention', value: '4 documents', tone: 'text-warning' },
            ].map((tile, index) => (
              <motion.div
                key={tile.label}
                className="rounded-xl border border-border/60 bg-card/60 p-3.5"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 + index * 0.08, duration: 0.4 }}
              >
                <p className="section-label">{tile.label}</p>
                <p className={cn('tabular mt-1 text-lg font-semibold', tile.tone)}>{tile.value}</p>
              </motion.div>
            ))}
          </div>

          {/* A truck tracing a route — the product's core motion in miniature. */}
          <div className="relative mx-4 mb-4 h-40 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-secondary/60 to-muted/40">
            <svg className="absolute inset-0 size-full" viewBox="0 0 400 160" fill="none" aria-hidden>
              <motion.path
                d="M20 130 C 90 130, 110 40, 190 60 S 300 120, 380 40"
                stroke="hsl(var(--border-strong))"
                strokeWidth="2.5"
                strokeDasharray="5 5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.4, delay: 0.9 }}
              />
              <motion.path
                d="M20 130 C 90 130, 110 40, 190 60 S 300 120, 380 40"
                stroke="hsl(var(--primary))"
                strokeWidth="3"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: [0, 1] }}
                transition={{ duration: 6, delay: 1.2, repeat: Infinity, ease: 'linear' }}
              />
              <motion.circle
                r="7"
                fill="hsl(var(--primary))"
                stroke="white"
                strokeWidth="2.5"
                initial={{ offsetDistance: '0%' }}
                animate={{ offsetDistance: '100%' }}
                transition={{ duration: 6, delay: 1.2, repeat: Infinity, ease: 'linear' }}
                style={{
                  offsetPath:
                    'path("M20 130 C 90 130, 110 40, 190 60 S 300 120, 380 40")',
                }}
              />
            </svg>
            <span className="glass absolute bottom-3 left-3 rounded-lg px-2.5 py-1.5 text-2xs font-medium">
              DL-01-AB-1234 · 58 km/h · ETA 2h 40m
            </span>
          </div>
        </Card>
      </motion.div>
    </section>
  );
}

function ProofBar() {
  return (
    <section className="border-y border-border/60 bg-card/40 px-5 py-10 backdrop-blur">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 sm:grid-cols-4">
        {PROOF_POINTS.map((point) => (
          <RevealOnScroll key={point.label} className="text-center">
            <p className="tabular text-3xl font-semibold tracking-tight">
              <AnimatedNumber value={point.value} />
              {point.suffix}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{point.label}</p>
          </RevealOnScroll>
        ))}
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section id="platform" className="px-5 py-20">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll className="mx-auto max-w-2xl text-center">
          <p className="section-label">The platform</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Everything a haul touches, in one place
          </h2>
          <p className="mt-4 text-muted-foreground">
            Not a tracker with features bolted on. Each part writes to the same operational record,
            so a delay on the road shows up in the customer’s view, the driver’s score and the
            month’s analytics without anyone re-entering it.
          </p>
        </RevealOnScroll>

        <Stagger className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <StaggerItem key={capability.title}>
              <Card variant="glass" className="group h-full p-6 surface-interactive">
                <div
                  className={cn(
                    'mb-4 inline-flex rounded-xl bg-gradient-to-br p-3 ring-1 ring-border',
                    capability.accent,
                  )}
                >
                  <capability.icon className="size-5" />
                </div>
                <h3 className="text-base font-semibold">{capability.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {capability.body}
                </p>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="relative overflow-hidden px-5 py-20">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute left-1/2 top-1/4 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[130px]" />
      </div>

      <div className="mx-auto max-w-5xl">
        <RevealOnScroll className="mx-auto max-w-2xl text-center">
          <p className="section-label">How it works</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            From “I need 20 tons of sand” to delivered
          </h2>
        </RevealOnScroll>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <RevealOnScroll key={step.step}>
              <Card variant="glass" className="h-full p-6">
                <div className="flex items-start gap-4">
                  <span className="shrink-0 rounded-xl bg-brand-gradient px-3 py-2 text-sm font-semibold text-primary-foreground">
                    {step.step}
                  </span>
                  <div>
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                  </div>
                </div>
                {index < STEPS.length - 1 ? (
                  <div className="mt-4 hidden justify-end sm:flex">
                    <ArrowRight className="size-4 text-muted-foreground/40" />
                  </div>
                ) : null}
              </Card>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

function ForEveryone() {
  return (
    <section id="roles" className="px-5 py-20">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll className="mx-auto max-w-2xl text-center">
          <p className="section-label">Built for everyone in the chain</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            One platform, four points of view
          </h2>
        </RevealOnScroll>

        <Stagger className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role) => (
            <StaggerItem key={role.role}>
              <Card variant="glass" className="h-full p-6">
                <role.icon className="size-5 text-primary" />
                <h3 className="mt-4 font-semibold">{role.role}</h3>
                <p className="mt-2 text-sm italic leading-relaxed text-muted-foreground">
                  {role.line}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {role.points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Check className="mt-0.5 size-3 shrink-0 text-success" />
                      {point}
                    </li>
                  ))}
                </ul>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="px-5 py-20">
      <div className="mx-auto max-w-6xl">
        <RevealOnScroll className="mx-auto max-w-2xl text-center">
          <p className="section-label">Pricing</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Priced by fleet size, not by seat
          </h2>
          <p className="mt-4 text-muted-foreground">
            One vehicle or fifty — you pay for the vehicles you run, and everyone in your team uses
            Saarthi. Every plan starts with a 30-day trial, and safety is never gated: SOS works on
            all of them, trial included.
          </p>
        </RevealOnScroll>

        <Stagger className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_CATALOGUE.map((plan) => {
            const featured = plan.tier === 'PRO';
            return (
              <StaggerItem key={plan.tier}>
                <Card
                  variant="glass"
                  className={cn(
                    'relative flex h-full flex-col p-6',
                    featured && 'ring-2 ring-primary/40',
                  )}
                >
                  {featured ? (
                    <Badge variant="default" className="absolute -top-2.5 left-6">
                      Most popular
                    </Badge>
                  ) : null}

                  <h3 className="font-semibold">
                    {plan.limits.maxTrucks === null
                      ? 'Unlimited vehicles'
                      : `${plan.limits.maxTrucks} vehicle${plan.limits.maxTrucks === 1 ? '' : 's'}`}
                  </h3>
                  <p className="mt-3 text-3xl font-semibold tracking-tight">
                    {plan.priceMonthly === null ? (
                      'Custom'
                    ) : (
                      <>
                        {formatCurrency(plan.priceMonthly)}
                        <span className="text-sm font-normal text-muted-foreground">/mo</span>
                      </>
                    )}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {plan.description}
                  </p>

                  <ul className="mt-5 flex-1 space-y-1.5">
                    {plan.features.slice(0, 6).map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-xs">
                        <Check className="mt-0.5 size-3 shrink-0 text-success" />
                        <span className="text-muted-foreground">
                          {feature.replace(/[._]/g, ' ')}
                        </span>
                      </li>
                    ))}
                    {plan.features.length > 6 ? (
                      <li className="pl-5 text-xs text-muted-foreground">
                        +{plan.features.length - 6} more
                      </li>
                    ) : null}
                  </ul>

                  <div className="mt-5 space-y-0.5 border-t border-border/60 pt-4 text-2xs text-muted-foreground">
                    <p>{plan.name}</p>
                    <p>
                      {formatCurrency(VEHICLE_TOPUP.priceMonthly)}/mo per extra vehicle
                      {' · '}
                      {plan.limits.trackingHistoryDays} days history
                    </p>
                  </div>

                  <Button
                    className="mt-4 w-full"
                    variant={featured ? 'gradient' : 'outline'}
                    asChild
                  >
                    <Link to="/register">
                      {plan.priceMonthly === null ? 'Talk to us' : 'Start free trial'}
                    </Link>
                  </Button>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>

        {/*
          The top-up sits below the grid rather than as a fifth column: it is
          not a plan anyone starts on, it is the answer to "I just bought one
          more truck" — which should not cost a jump to the next plan.
        */}
        <RevealOnScroll className="mx-auto mt-6 max-w-3xl">
          <Card variant="glass" className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
            <div className="flex-1">
              <h3 className="font-semibold">{VEHICLE_TOPUP.name} top-up</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Outgrown your plan by one vehicle? Add exactly one, for{' '}
                {formatCurrency(VEHICLE_TOPUP.priceMonthly)} a month. Stack as many as you need,
                cancel any of them individually.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link to="/register">Start free trial</Link>
            </Button>
          </Card>
        </RevealOnScroll>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 pb-24 pt-8">
      <RevealOnScroll className="mx-auto max-w-4xl">
        <Card variant="glass" className="relative overflow-hidden p-10 text-center sm:p-14">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
            <div className="absolute -left-20 -top-20 size-72 rounded-full bg-primary/25 blur-[100px]" />
            <div className="absolute -bottom-20 -right-16 size-72 rounded-full bg-accent/25 blur-[100px]" />
          </div>

          <h2 className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Put your whole operation on one screen
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Set up your fleet in minutes. Add a truck, add a driver, post a load — and watch the
            first trip move across the map.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="xl" variant="gradient" asChild className="w-full sm:w-auto">
              <Link to="/register">
                Create your account
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="xl" variant="outline" asChild className="w-full sm:w-auto">
              <Link to="/login">Explore the demo fleet</Link>
            </Button>
          </div>

          <p className="mt-5 text-xs text-muted-foreground">
            The demo is a fully seeded fleet — eight trucks, live tracking and a working SOS network.
          </p>
        </Card>
      </RevealOnScroll>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 px-5 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <SaarthiLogo className="h-7" />
          <div>
            <p className="text-sm font-semibold">VorldX Saarthi</p>
            <p className="text-2xs text-muted-foreground">
              The operating system for your trucking business
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <a href="#platform" className="hover:text-foreground">
            Platform
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
          <Link to="/login" className="hover:text-foreground">
            Sign in
          </Link>
          <Link to="/register" className="hover:text-foreground">
            Get started
          </Link>
        </div>
      </div>

      <p className="mx-auto mt-8 max-w-6xl text-center text-2xs text-muted-foreground">
        Saarthi’s emergency network connects nearby drivers who may be able to help. It does not
        replace official emergency services — always call 112 first in a life-threatening situation.
      </p>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-full bg-canvas">
      <MarketingNav />
      <main>
        <Hero />
        <ProofBar />
        <Capabilities />
        <HowItWorks />
        <ForEveryone />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

export default LandingPage;
