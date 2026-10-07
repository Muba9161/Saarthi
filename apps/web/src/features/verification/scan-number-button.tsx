import * as React from 'react';
import { ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import type { ScannableNumberKind, ScannedCard } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { useCardScan, type CardScanResult } from './scan-card';

/** Tell the person what the scan did, in one line, whatever happened. */
export function announceScan(result: CardScanResult, label: string): void {
  if (result.status === 'found') {
    toast.success(`${label} details read from the card`, {
      description: 'Check them against the card before you verify.',
    });
  } else if (result.status === 'not-found') {
    toast.info('Could not read the number clearly', {
      description: 'Try a sharper photo in good light, with the whole card in view - or type it in.',
    });
  } else {
    toast.error('This photo could not be read here', {
      description: 'Try a JPG or PNG photo, or type the number in.',
    });
  }
}

/**
 * "Scan card" beside a number field: take or pick a photo of the card, and the
 * form fills itself in from it — the number, and whichever of the other
 * details it asks for the card shows clearly. On a phone the picker offers the
 * camera directly. The photo is read on this device and is not uploaded.
 */
export function ScanNumberButton({
  kind,
  label,
  onScan,
}: {
  kind: ScannableNumberKind;
  /** The document's name, for the confirmation, e.g. "PAN". */
  label: string;
  /** Called with everything read off the card; the form takes the fields it asks for. */
  onScan: (card: ScannedCard) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const { scan, reading } = useCardScan(kind);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same photo again still triggers a read.
    event.target.value = '';
    if (!file) return;
    const result = await scan(file);
    if (result.status === 'found') onScan(result.card);
    announceScan(result, label);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => void onFile(event)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={reading}
        onClick={() => inputRef.current?.click()}
        aria-label={`Scan the ${label} card to fill in its details`}
      >
        <ScanLine className="size-4" aria-hidden />
        {reading ? 'Reading card…' : 'Scan card'}
      </Button>
    </>
  );
}
