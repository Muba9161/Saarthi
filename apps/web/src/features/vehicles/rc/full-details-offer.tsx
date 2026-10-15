import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFullDetails } from './use-full-details';

/**
 * "Want to know more about your vehicle?": the paid full record, offered on the
 * vehicle's RC section while it has only the free basic record, or none.
 *
 * The plate is the vehicle's own and is read on the server, so there is
 * nothing to type: one button, the same Pay & Verify payment as every ₹10
 * check, then `onFetched` reloads the Virtual RC with the full record.
 */
export function FullDetailsOffer({
  vehicleId,
  onFetched,
  className,
}: {
  vehicleId: string;
  onFetched: () => void;
  className?: string;
}) {
  const full = useFullDetails();

  const buy = async (): Promise<void> => {
    if (await full.buy({ subjectType: 'TRUCK', subjectId: vehicleId })) onFetched();
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[14px] border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center',
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold">Want to know more about your vehicle?</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Full details add what the basic record often misses - make, model, fuel, colour and
          emission norms - plus the RC certificate. Nothing to type: we use this vehicle&rsquo;s
          registration.
        </p>
        {full.problem ? (
          <p role="alert" className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-[13px]">
            {full.problem}
          </p>
        ) : null}
      </div>
      <Button
        className="shrink-0 rounded-[12px]"
        loading={full.busy}
        disabled={!full.available}
        onClick={() => void buy()}
      >
        {full.label}
      </Button>
    </div>
  );
}
