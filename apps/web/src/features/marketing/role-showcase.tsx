import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, useReducedMotion } from '@/components/motion';
import { Section, SectionHeading } from './marketing-chrome';
import { ROLE_SHOWCASE, type RoleShowcase } from './feature-catalogue';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * What one kind of account actually opens to.
 *
 * The destination list is the role's real navigation tree, imported from
 * `@/app/navigation` — the same data the signed-in shell renders. So this is
 * not a promise about the product, it is its table of contents. Items still
 * carry their own permission and plan gates inside the app; what is listed
 * here is the full surface the account type can reach.
 *
 * Destinations are plain rows, not bordered chips. Twenty-five chips in a grid
 * is a mosaic nobody reads; twenty-five names under six headings is a menu,
 * which is what it is.
 */
function RolePanel({ role }: { role: RoleShowcase }) {
  const reduced = useReducedMotion();
  const destinations = role.navigation.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <motion.div
      // Keyed by the caller so React remounts and replays the stagger on every
      // role change; no exit, so the previous role's screens never linger.
      initial={reduced ? false : 'hidden'}
      animate={reduced ? undefined : 'visible'}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
      className="min-w-0"
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 16 },
          visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
        }}
      >
        <blockquote className="text-balance text-xl font-medium leading-snug tracking-[-0.01em] sm:text-2xl">
          <span className="text-accent" aria-hidden>
            “
          </span>
          {role.quote}
          <span className="text-accent" aria-hidden>
            ”
          </span>
        </blockquote>

        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {role.blurb}
        </p>

        <p className="mt-5 text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{destinations}</span>{' '}
          destinations in this account&rsquo;s sidebar
        </p>
      </motion.div>

      <motion.div
        variants={{
          hidden: { opacity: 0, y: 16 },
          visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
        }}
        className="mt-10 grid gap-x-8 gap-y-8 border-t border-border/60 pt-8 sm:grid-cols-2 xl:grid-cols-3"
      >
        {role.navigation.map((section) => (
          <div key={section.title} className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {section.title}
            </p>
            <ul className="mt-3 space-y-2">
              {section.items.map((item) => (
                <li
                  key={`${section.title}-${item.to}-${item.label}`}
                  className="group flex items-center gap-2.5 text-sm text-foreground/80 transition-colors duration-200 hover:text-foreground"
                >
                  <item.icon
                    className="size-3.5 shrink-0 text-primary/60 transition-colors duration-200 group-hover:text-primary"
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}

export function RoleShowcaseSection() {
  const [activeId, setActiveId] = React.useState(ROLE_SHOWCASE[0]?.id ?? 'fleet');
  const active = ROLE_SHOWCASE.find((role) => role.id === activeId) ?? ROLE_SHOWCASE[0];

  return (
    <Section id="roles" width="wide" tone="raised">
      <SectionHeading
        eyebrow="Who it is for"
        title="One platform, seven points of view"
        body="A haul touches a fleet owner, a driver, a supplier and a customer — and often an association and a platform reviewer too. Each opens their own screens over the same record, so nobody re-enters what somebody else already typed."
      />

      <div className="mt-14 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
        <div
          role="tablist"
          aria-label="Account types"
          aria-orientation="vertical"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 scrollbar-none lg:mx-0 lg:h-fit lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {ROLE_SHOWCASE.map((role) => {
            const selected = active?.id === role.id;
            return (
              <button
                key={role.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(role.id)}
                className={cn(
                  'relative flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left',
                  'transition-colors duration-200',
                  selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {selected ? (
                  <motion.span
                    layoutId="role-pill"
                    className="absolute inset-0 rounded-xl border border-primary/25 bg-primary/[0.07]"
                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                  />
                ) : null}
                <role.icon
                  className={cn(
                    'relative size-4 shrink-0',
                    selected ? 'text-primary' : 'opacity-70',
                  )}
                  aria-hidden
                />
                <span className="relative whitespace-nowrap text-sm font-medium">{role.label}</span>
              </button>
            );
          })}
        </div>

        {/* `role="tabpanel"` with a key so the panel is announced as new and
            the stagger replays. */}
        <div className="min-w-0" role="tabpanel" aria-label={active?.label}>
          {active ? <RolePanel key={active.id} role={active} /> : null}
        </div>
      </div>

      <div className="mt-16 flex flex-col items-center gap-4 text-center">
        <p className="max-w-lg text-sm text-muted-foreground">
          Registration asks which of these you are, because it decides what Saarthi builds for you —
          a fleet, a yard, a customer account, or a driver profile inside an existing fleet.
        </p>
        <Button variant="outline" asChild className="group rounded-full">
          <Link to="/register">
            Pick your account type
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </div>
    </Section>
  );
}
