import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, TicketPercent } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { BillingCoupon, BillingStatus } from './billing-card';

function inrDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** What a coupon in force gives, in a few words. */
export function describeCoupon(coupon: BillingCoupon): string {
  if (coupon.freeUntil) return `Free until ${inrDate(coupon.freeUntil)}`;
  const months = coupon.monthsLeft ?? 0;
  return `${coupon.percentOff}% off · ${months} discounted month${months === 1 ? '' : 's'} left`;
}

/**
 * Where an owner enters a coupon code: the Billing card and the expired
 * screen. Codes are checked by the API alone; a refusal is shown under the
 * field so it can be corrected in place. For three months after a coupon is
 * entered no other can be, so the field gives way to the date it opens again.
 */
export function CouponForm({
  lockedUntil,
  onApplied,
  className,
}: {
  lockedUntil: string | null;
  onApplied: () => void;
  className?: string;
}) {
  const id = React.useId();
  const errorId = `${id}-error`;
  const [code, setCode] = React.useState('');

  const apply = useMutation({
    mutationFn: (value: string) =>
      api.post<BillingStatus | null>('/subscriptions/billing/coupon', { code: value }),
    onSuccess: (status) => {
      setCode('');
      toast.success('Coupon applied', {
        description: status?.coupon ? describeCoupon(status.coupon) : undefined,
      });
      onApplied();
    },
  });
  const error = apply.isError ? errorMessage(apply.error) : null;
  const trimmed = code.trim();

  if (lockedUntil) {
    return (
      <div className={cn('space-y-1.5', className)}>
        <p className="text-sm font-medium leading-none">Coupon code</p>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{`A coupon was used in the last 3 months. You can enter another one after ${inrDate(lockedUntil)}.`}</span>
        </p>
      </div>
    );
  }

  return (
    <form
      className={cn('space-y-2', className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) apply.mutate(trimmed);
      }}
    >
      <Label htmlFor={id}>Have a coupon code?</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            if (apply.isError) apply.reset();
          }}
          placeholder="Enter code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          className="uppercase placeholder:normal-case"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!trimmed || apply.isPending}
          loading={apply.isPending}
        >
          <TicketPercent className="size-4" aria-hidden />
          Apply
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
