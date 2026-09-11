import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowUp, Info, Printer, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  MarketingFooter,
  MarketingNav,
  useActiveSection,
} from '@/features/marketing/marketing-chrome';
import { Reveal } from '@/features/marketing/motion-extras';
import { STAGE } from '@/features/marketing/imagery';
import {
  formatLegalDate,
  isPlaceholder,
  unresolvedLegalFields,
  type DocumentVersion,
} from './legal-entity';
import { cn } from '@/lib/utils';

/**
 * The shell both legal documents are rendered in.
 *
 * Two decisions shape it.
 *
 * The first is that a legal document is a reference, not a story. Nobody reads
 * one top to bottom; they arrive looking for the clause about location data,
 * or for who to complain to. So the structure is a numbered contents list that
 * stays on screen, every section is linkable by anchor, and the type is set at
 * a width that stays readable for two thousand words rather than at the
 * marketing site's display sizes.
 *
 * The second is that it is still the same site. It carries the public
 * `MarketingNav` and `MarketingFooter`, and it opens on the same near-black
 * stage the hero and the safety band use, so arriving here from the footer
 * does not feel like being handed off to a different product. Everything below
 * that stage is token-driven and follows the theme.
 *
 * Sections are supplied as data rather than as children so the contents list
 * cannot fall out of step with the document: the same array produces both.
 */

export interface LegalSectionSpec {
  /** Anchor, and the fragment a link may deep-link to. Kebab case. */
  id: string;
  title: string;
  body: React.ReactNode;
}

/* -------------------------------------------------------------------------
 * Prose primitives
 *
 * Deliberately plain. Legal copy is long, and a document whose paragraphs each
 * carry their own utility strings drifts in leading and colour from section to
 * section — which reads as carelessness in exactly the document where it is
 * least affordable.
 * ---------------------------------------------------------------------- */

/** A paragraph. The default voice of both documents. */
export function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-sm leading-[1.75] text-muted-foreground', className)}>{children}</p>
  );
}

/** A heading inside a section, for a clause that needs to be findable. */
export function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-7 text-sm font-semibold text-foreground">{children}</h3>;
}

/** An unordered list. Used for anything the reader may scan rather than read. */
export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-sm leading-[1.7] text-muted-foreground">
          <span className="mt-[0.6rem] size-1 shrink-0 rounded-full bg-primary/60" aria-hidden />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A numbered list, where the order or the count is part of the meaning. */
export function Numbered({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-sm leading-[1.7] text-muted-foreground">
          <span className="mt-px w-5 shrink-0 text-2xs font-semibold tabular-nums text-primary">
            {index + 1}.
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Term and meaning.
 *
 * A real `<dl>` rather than a two-column grid of divs: assistive technology
 * announces the pairing, which is the whole point of a definitions section.
 */
export function DefinitionList({ items }: { items: { term: string; text: React.ReactNode }[] }) {
  return (
    <dl className="space-y-4">
      {items.map((item) => (
        <div key={item.term} className="sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-5">
          <dt className="text-sm font-semibold text-foreground">{item.term}</dt>
          <dd className="mt-1 text-sm leading-[1.7] text-muted-foreground sm:mt-0">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A table of facts - what we keep, for how long, and why.
 *
 * Scrolls inside itself on a phone rather than widening the page, because a
 * legal document that scrolls sideways loses the reader who needed it most.
 */
export function FactTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="border-b border-border pb-2.5 pr-4 align-bottom text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground last:pr-0"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="align-top">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    'border-b border-border/60 py-3 pr-4 leading-[1.6] last:pr-0',
                    cellIndex === 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A clause the reader must not skim past.
 *
 * Two tones only. `warning` is reserved for the handful of statements where
 * skimming has a real cost - that SOS is not the emergency services, that AI
 * output is not advice, that a scanned QR code discloses data to a stranger.
 * Using it for anything else would spend the attention it buys.
 */
export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning';
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === 'warning' ? AlertTriangle : Info;

  return (
    <div
      className={cn(
        'flex gap-3.5 rounded-xl border p-4',
        tone === 'warning'
          ? 'border-warning/30 bg-warning/[0.07]'
          : 'border-border bg-secondary/40',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'warning' ? 'text-warning' : 'text-primary',
        )}
        aria-hidden
      />
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <div className="text-sm leading-[1.7] text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/** An inline link, styled so it is visible inside a wall of grey prose. */
export function LegalLink({ to, children }: { to: string; children: React.ReactNode }) {
  const style =
    'font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary';

  if (to.startsWith('http')) {
    return (
      <a href={to} target="_blank" rel="noreferrer noopener" className={style}>
        {children}
      </a>
    );
  }
  if (to.startsWith('mailto:')) {
    return (
      <a href={to} className={style}>
        {children}
      </a>
    );
  }

  return (
    <Link to={to} className={style}>
      {children}
    </Link>
  );
}

/**
 * An address from `LEGAL_ENTITY`, as a mail link once it is a real one.
 *
 * A `mailto:` pointing at an unfilled placeholder opens the reader's mail
 * client addressed to nothing, which is worse than no link at all - so until
 * the address is set this renders as the same visible gap the rest of the
 * entity details use.
 */
export function Mailto({ address }: { address: string }) {
  if (isPlaceholder(address)) return <span className="text-foreground">[to be completed]</span>;
  return <LegalLink to={`mailto:${address}`}>{address}</LegalLink>;
}

/* -------------------------------------------------------------------------
 * Document shell
 * ---------------------------------------------------------------------- */

/**
 * Names the tab after the document, and puts the old title back on the way out.
 *
 * The app ships one static `<title>` for the whole SPA. That is tolerable
 * behind the sign-in wall, where every screen is the same product, but these
 * two pages are the ones a person bookmarks, prints and sends to their lawyer,
 * and all three carry the title with them.
 */
function useDocumentTitle(title: string): void {
  React.useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/**
 * Starts the reader at the top, unless they arrived at an anchor.
 *
 * The router keeps the browser's scroll position across a client-side
 * navigation, so following "Privacy Policy" from the foot of the landing page
 * would otherwise drop the reader two thousand words into the document.
 */
function useScrollToTop(hash: string): void {
  React.useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView({ block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [hash]);
}

/**
 * Development-only notice that the entity details are still placeholders.
 *
 * Stripped from the production bundle by the `import.meta.env.DEV` guard, so
 * this costs a customer nothing. It exists because the failure it catches is
 * silent: a published privacy policy naming nobody to complain to reads as
 * finished, and nothing in a build will otherwise object.
 */
function PlaceholderNotice() {
  const missing = React.useMemo(() => unresolvedLegalFields(), []);
  if (!import.meta.env.DEV || missing.length === 0) return null;

  return (
    <div className="mb-10 rounded-xl border border-warning/40 bg-warning/[0.08] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlertTriangle className="size-4 text-warning" aria-hidden />
        {missing.length} legal detail{missing.length === 1 ? '' : 's'} still to be filled in
      </p>
      <p className="mt-1.5 text-2xs text-muted-foreground">
        Development build only. Set these in{' '}
        <code className="rounded bg-secondary px-1 py-0.5">features/legal/legal-entity.ts</code>{' '}
        before this goes in front of customers.
      </p>
      <ul className="mt-3 space-y-1">
        {missing.map((field) => (
          <li key={field} className="text-2xs text-muted-foreground">
            <code className="rounded bg-secondary px-1 py-0.5 text-foreground">
              {field.split(' (')[0]}
            </code>{' '}
            {field.slice(field.indexOf('(') + 1, -1)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The contents list. Shared by the desktop rail and the phone disclosure. */
function Contents({
  sections,
  active,
  className,
}: {
  sections: LegalSectionSpec[];
  active: string | null;
  className?: string;
}) {
  return (
    <nav aria-label="Contents" className={className}>
      <ol className="space-y-0.5">
        {sections.map((section, index) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? 'true' : undefined}
              className={cn(
                'flex gap-2.5 rounded-lg px-2.5 py-1.5 text-xs leading-snug transition-colors',
                active === section.id
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
            >
              <span className="w-4 shrink-0 tabular-nums opacity-60">{index + 1}</span>
              <span className="min-w-0">{section.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LegalDocument({
  eyebrow,
  title,
  summary,
  version,
  sections,
  related,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  version: DocumentVersion;
  sections: LegalSectionSpec[];
  /** The sibling document, linked from the head of the page. */
  related: { to: string; label: string };
}) {
  const { hash } = useLocation();
  const ids = React.useMemo(() => sections.map((section) => section.id), [sections]);
  const active = useActiveSection(ids);

  useDocumentTitle(`${title} - VorldX Saarthi`);
  useScrollToTop(hash);

  return (
    <div className="min-h-full bg-canvas">
      <MarketingNav />

      <main>
        {/* The stage.

            It slides under the header on the same `-mt-[4.5rem]` the landing
            hero uses, rather than starting below it. Two reasons: the page
            then opens the way the rest of the public site does, with the
            chrome floating over a dark ground instead of a light bar butting
            against a black block; and `useOverStage` - which defaults to true
            and corrects itself after the first frame - is then already right
            on arrival, so the nav never flashes light ink on a light bar.

            `data-stage` is what that hook reads. */}
        <section
          data-stage
          className={cn(
            'relative overflow-hidden px-5 pb-16 sm:px-8 sm:pb-20',
            '-mt-[4.5rem] pt-[9.5rem] sm:pt-[11rem]',
            STAGE,
          )}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                'radial-gradient(60% 50% at 15% 0%, hsl(var(--primary) / 0.45), transparent 70%), radial-gradient(45% 45% at 85% 20%, hsl(var(--accent) / 0.25), transparent 70%)',
            }}
            aria-hidden
          />

          <div className="relative mx-auto max-w-6xl">
            <Reveal direction="none" duration={0.5}>
              <p className="flex items-center gap-2.5 text-2xs font-semibold uppercase tracking-[0.16em] text-accent">
                <span className="h-px w-6 bg-accent/50" aria-hidden />
                {eyebrow}
              </p>
            </Reveal>

            <Reveal delay={0.06}>
              <h1 className="mt-5 max-w-3xl text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.025em] sm:text-4xl lg:text-[2.75rem]">
                {title}
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-white/70">
                {summary}
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-2xs text-white/55">
                <span>
                  <span className="text-white/40">Version</span> {version.version}
                </span>
                <span>
                  <span className="text-white/40">In effect from</span>{' '}
                  {formatLegalDate(version.effectiveDate)}
                </span>
                <span>
                  <span className="text-white/40">Last updated</span>{' '}
                  {formatLegalDate(version.lastUpdated)}
                </span>
              </div>
            </Reveal>

            <Reveal delay={0.24}>
              <div className="mt-8 flex flex-wrap gap-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                >
                  <Link to={related.to}>
                    <ShieldCheck className="size-3.5" />
                    {related.label}
                  </Link>
                </Button>
                {/* Printing is how these documents actually get filed. The
                    browser's own dialog is the right control for it. */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.print()}
                  className="text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <Printer className="size-3.5" />
                  Print or save as PDF
                </Button>
              </div>
            </Reveal>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <PlaceholderNotice />

          <div className="gap-12 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
            {/* The rail. Sticky and independently scrollable, so a
                twenty-section document does not push its own contents list off
                the screen. */}
            <aside className="hidden lg:block">
              <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pb-6 pr-2">
                <p className="px-2.5 pb-2.5 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Contents
                </p>
                <Contents sections={sections} active={active} />
              </div>
            </aside>

            <div className="min-w-0">
              {/* On a phone the list is collapsed: it is navigation for a
                  document somebody is about to read, not the document. */}
              <details className="mb-10 rounded-xl border border-border bg-secondary/30 lg:hidden">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">
                  Contents ({sections.length} sections)
                </summary>
                <div className="border-t border-border p-2">
                  <Contents sections={sections} active={active} />
                </div>
              </details>

              <article className="space-y-14">
                {sections.map((section, index) => (
                  <section key={section.id} id={section.id} className="scroll-mt-24">
                    <h2 className="flex gap-3 text-lg font-semibold leading-snug tracking-tight text-foreground sm:text-xl">
                      <span className="mt-1 w-7 shrink-0 text-sm tabular-nums text-primary/70 sm:mt-1.5">
                        {index + 1}
                      </span>
                      <span className="min-w-0 text-balance">{section.title}</span>
                    </h2>
                    <div className="mt-4 space-y-4 sm:pl-10">{section.body}</div>
                  </section>
                ))}
              </article>

              <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
                <p className="text-2xs text-muted-foreground">
                  {title}, version {version.version}, in effect from{' '}
                  {formatLegalDate(version.effectiveDate)}.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  <ArrowUp className="size-3.5" />
                  Back to top
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
