import { Info } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import {
  PlanTier,
  VEHICLE_TOPUP,
  formatCurrency,
  type RegisterInput,
  type RegistrableRole,
} from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import {
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { AnimatePresence, motion } from '@/components/motion';
import { useLocale } from '@/features/i18n';
import { PLAN_LABEL } from '@/features/subscriptions/plan-copy';
import { TRIAL_DAYS } from '@/features/subscriptions/trial-days';
import { ChoiceCard, ChoiceGroup } from './choice-card';
import {
  REGISTRATION_PLANS,
  planIncludesVehicles,
  planMonthlyPrice,
  type AccountTypeChoice,
} from './plan-options';

const EASE = [0.16, 1, 0.3, 1] as const;

/** The price beside a plan: the figure in weight, the period under it. */
function PlanPrice({ tier }: { tier: PlanTier }) {
  const { t } = useLocale();
  const price = planMonthlyPrice(tier);

  // Zero is shown as "No charge": "₹0/month" reads like a trial about to end.
  if (price === 0) {
    return <span className="block text-sm font-semibold">{t('No charge')}</span>;
  }
  return (
    <>
      <span className="block text-sm font-semibold tabular-nums">{formatCurrency(price)}</span>
      <span className="block text-2xs text-muted-foreground">{t('a month')}</span>
    </>
  );
}

/** One line on what the chosen plan costs and covers, in place of a summary box. */
function planTerms(tier: PlanTier, t: ReturnType<typeof useLocale>['t']): string {
  if (tier === PlanTier.FREE) return t('Nothing to pay, and no card needed.');

  const values = {
    days: TRIAL_DAYS,
    price: formatCurrency(planMonthlyPrice(tier)),
    topup: formatCurrency(VEHICLE_TOPUP.priceMonthly),
  };
  if (planIncludesVehicles(tier)) {
    return TRIAL_DAYS > 0
      ? t('Free for {days} days, then {price} a month. One vehicle included; each extra is {topup} a month.', values)
      : t('{price} a month. One vehicle included; each extra is {topup} a month.', values);
  }
  return TRIAL_DAYS > 0
    ? t('Free for {days} days, then {price} a month. No vehicles to set up.', values)
    : t('{price} a month. No vehicles to set up.', values);
}

/** The first question: which plan. Shown when the pricing page did not already answer it. */
export function PlanStep({
  form,
  plan,
  onChoose,
}: {
  form: UseFormReturn<RegisterInput>;
  plan: PlanTier | null;
  onChoose: (tier: PlanTier) => void;
}) {
  const { t } = useLocale();

  return (
    <FormField
      control={form.control}
      name="planTier"
      render={() => (
        <FormItem>
          <FormLabel required>{t('Choose your plan')}</FormLabel>
          <FormDescription>
            {TRIAL_DAYS > 0
              ? t('Paid plans start with {days} days free. You can change plan later.', {
                  days: TRIAL_DAYS,
                })
              : t('You can change plan later.')}
          </FormDescription>

          <ChoiceGroup label={t('Choose your plan')} className="pt-1">
            {REGISTRATION_PLANS.map((option, index) => (
              <ChoiceCard
                key={option.tier}
                icon={option.icon}
                title={t(PLAN_LABEL[option.tier])}
                description={t(option.audience)}
                meta={<PlanPrice tier={option.tier} />}
                selected={plan === option.tier}
                focusable={plan ? plan === option.tier : index === 0}
                onSelect={() => onChoose(option.tier)}
                index={index}
              />
            ))}
          </ChoiceGroup>

          <AnimatePresence initial={false} mode="wait">
            {plan ? (
              <motion.p
                key={plan}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="flex items-start gap-2 pt-1 text-xs leading-relaxed text-muted-foreground"
              >
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {planTerms(plan, t)}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** The second question: which kind of account inside the chosen plan. */
export function AccountTypeStep({
  form,
  choice,
  onChoose,
}: {
  form: UseFormReturn<RegisterInput>;
  choice: AccountTypeChoice;
  onChoose: (role: RegistrableRole) => void;
}) {
  const { t } = useLocale();

  return (
    <FormField
      control={form.control}
      name="role"
      render={({ field }) => (
        <FormItem>
          <FormLabel required>{t(choice.question)}</FormLabel>
          {choice.hint ? <FormDescription>{t(choice.hint)}</FormDescription> : null}

          <ChoiceGroup label={t(choice.question)} className="pt-1">
            {choice.options.map((option, index) => (
              <ChoiceCard
                key={option.role}
                icon={option.icon}
                title={t(option.title)}
                description={t(option.description)}
                selected={field.value === option.role}
                focusable={field.value ? field.value === option.role : index === 0}
                onSelect={() => onChoose(option.role)}
                index={index}
              />
            ))}
          </ChoiceGroup>

          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * The plan the pricing page sent, standing in for the step that would have
 * asked it — with the way back to that step, should they want another.
 */
export function PlanSummary({ tier, onChange }: { tier: PlanTier; onChange: () => void }) {
  const { t } = useLocale();
  const price = planMonthlyPrice(tier);

  return (
    <div className="glass-inset flex items-center justify-between gap-3 px-3 py-2.5 lg:block">
      <div className="min-w-0">
        <p className="section-label">{t('Your plan')}</p>
        <p className="mt-0.5 text-sm font-medium">
          {t(PLAN_LABEL[tier])}
          <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
            {price === 0
              ? t('No charge')
              : t('{price} a month', { price: formatCurrency(price) })}
          </span>
        </p>
      </div>
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={onChange}
        className="h-auto shrink-0 p-0 text-xs lg:mt-1"
      >
        {t('Change plan')}
      </Button>
    </div>
  );
}
