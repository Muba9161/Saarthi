import * as React from 'react';
import { Check, X } from 'lucide-react';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';

/**
 * Live feedback on a new password.
 *
 * The rules shown here are exactly the ones `passwordSchema` enforces in
 * `@saarthi/shared` — ten characters, a lower case letter, an upper case
 * letter and a digit. Showing them as a checklist that ticks off while typing
 * turns four separate rejected submits into none, which matters most on the
 * registration wizard where the password is on the final step and a rejection
 * costs the whole form.
 *
 * The two extras — length and a symbol — are *not* requirements. They only
 * move the meter from "Good" to "Strong", so the bar has somewhere to go once
 * the rules are satisfied rather than sitting full and mute.
 */

export interface PasswordRule {
  id: string;
  /** English source text — translated at render. */
  label: string;
  met: boolean;
}

/**
 * Indexed by score. Index 0 is never rendered — an empty field shows no
 * verdict at all — but the entry has to exist so the lookup is total.
 */
const TIERS = [
  { label: 'Weak', bar: 'bg-destructive', text: 'text-destructive' },
  { label: 'Weak', bar: 'bg-destructive', text: 'text-destructive' },
  { label: 'Fair', bar: 'bg-warning', text: 'text-warning' },
  { label: 'Good', bar: 'bg-info', text: 'text-info' },
  { label: 'Strong', bar: 'bg-success', text: 'text-success' },
] as const;

/** The required rules, in the order they read best. */
export function passwordRules(value: string): PasswordRule[] {
  return [
    { id: 'length', label: 'At least 10 characters', met: value.length >= 10 },
    { id: 'lower', label: 'One lower case letter', met: /[a-z]/.test(value) },
    { id: 'upper', label: 'One upper case letter', met: /[A-Z]/.test(value) },
    { id: 'digit', label: 'One number', met: /\d/.test(value) },
  ];
}

/** 0–4. Only a password that clears every rule can score above 2. */
function scoreOf(value: string, rules: PasswordRule[]): number {
  if (!value) return 0;
  const met = rules.filter((rule) => rule.met).length;
  if (met < rules.length) return met === 0 ? 1 : Math.min(2, met);

  const bonus = (value.length >= 14 ? 1 : 0) + (/[^A-Za-z0-9]/.test(value) ? 1 : 0);
  return bonus > 0 ? 4 : 3;
}

export function PasswordStrength({ value, className }: { value: string; className?: string }) {
  const t = useT();
  const rules = React.useMemo(() => passwordRules(value), [value]);
  const score = scoreOf(value, rules);
  const tier = TIERS[score] ?? TIERS[0];

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((segment) => (
            <span
              key={segment}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300',
                score >= segment ? tier.bar : 'bg-border dark:bg-white/10',
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            'w-16 shrink-0 text-right text-2xs font-semibold tabular-nums transition-colors',
            value ? tier.text : 'text-muted-foreground',
          )}
          // Announced politely so a screen reader hears the verdict change
          // without the checklist below being read out on every keystroke.
          aria-live="polite"
        >
          {value ? t(tier.label) : ''}
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              'flex items-center gap-1.5 text-2xs transition-colors',
              rule.met ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {rule.met ? (
              <Check className="size-3 shrink-0" strokeWidth={3} aria-hidden />
            ) : (
              <X className="size-3 shrink-0 opacity-50" aria-hidden />
            )}
            <span>{t(rule.label)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
