import { Link } from 'react-router-dom';
import { SaarthiWordmark } from '@/components/common/logo';
import { AUTH_HIGHLIGHTS, BrandBackdrop } from '@/features/auth/auth-brand';
import { FestiveParticles, FestiveWish, useFestive } from '@/features/festive';
import { useT } from '@/features/i18n';
import { LEGAL_LINKS } from '@/features/legal/legal-links';

/**
 * The modal's left panel: the brand, what Saarthi is, and on a festival day
 * the wish in the visitor's language with the festival's pieces drifting
 * behind it. Hidden below `lg`, where the form needs the whole width.
 */
export function AuthStage() {
  const t = useT();
  const { active } = useFestive();

  return (
    <aside className="relative hidden flex-col overflow-hidden rounded-l-[22px] bg-sidebar p-7 text-sidebar-foreground lg:flex [html[data-festive]_&]:pt-12">
      <BrandBackdrop />
      <FestiveParticles count={18} travel={760} />

      <div className="relative z-[1] flex h-full flex-col gap-6">
        <Link
          to="/"
          className="self-start rounded-lg transition-opacity duration-200 hover:opacity-90"
        >
          <SaarthiWordmark
            onDark
            className="[&_p:first-child]:text-sidebar-foreground [&_p:last-child]:text-sidebar-muted"
          />
        </Link>

        {active ? (
          <FestiveWish tone="dark" size="lg" />
        ) : (
          <div className="space-y-2.5">
            <h2 className="text-2xl font-semibold leading-tight tracking-tight">
              {t('The operating system for everything you move.')}
            </h2>
            <p className="text-sm leading-relaxed text-sidebar-muted">
              {t(
                'Saarthi connects fleet owners, drivers, sellers and customers on one platform - from posting a load to watching it arrive.',
              )}
            </p>
          </div>
        )}

        <ul className="mt-auto space-y-3.5">
          {AUTH_HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] ring-1 ring-inset ring-white/10">
                <Icon className="size-3.5 text-accent" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-snug">{t(title)}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-sidebar-muted">
                  {t(body)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[0.08] pt-4 text-2xs text-sidebar-muted">
          <span>© {new Date().getFullYear()} VorldX Saarthi</span>
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="underline-offset-4 transition-colors hover:text-sidebar-foreground hover:underline"
            >
              {t(link.label)}
            </Link>
          ))}
        </p>
      </div>
    </aside>
  );
}
