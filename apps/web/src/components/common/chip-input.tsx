import * as React from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WizardField } from '@/components/common/form-wizard';

/**
 * Free-text lists (destinations, inclusions, languages) as removable chips.
 *
 * Lives here rather than next to the one form that first needed it because
 * every provider-side form asks for at least one such list, and a second copy
 * would drift on the Enter handling below — which is the only subtle part.
 */
export function ChipInput({
  id,
  label,
  placeholder,
  values,
  onChange,
  required,
  error,
  hint,
  maxLength,
}: {
  id: string;
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  required?: boolean;
  error?: string | null;
  hint?: string;
  /** Per-chip character limit, mirroring what the API accepts. */
  maxLength?: number;
}) {
  const [draft, setDraft] = React.useState('');

  const commit = (): void => {
    const value = draft.trim();
    if (!value || values.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  return (
    <WizardField label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds a chip. Without this it would reach the wizard and
            // advance the step instead.
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commit();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={commit}>
          Add
        </Button>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {values.map((value) => (
            <Badge key={value} variant="secondary" size="sm" className="gap-1">
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((entry) => entry !== value))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </WizardField>
  );
}
