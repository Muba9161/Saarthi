import * as React from 'react';
import { ArrowRight, Loader2, Pencil, Sparkles } from 'lucide-react';
import type { CommerceTaxonomyIndex } from '@saarthi/shared';
import { WizardField } from '@/components/common/form-wizard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AttributeFields } from './attribute-fields';
import { CategoryPicker } from './category-picker';
import type { CommerceEntry } from './use-commerce';

/**
 * Small input → interpretation → only what is missing.
 *
 * The user types one line. What the engine recognised is shown back as
 * "Detected", always editable; required details it could not read are asked
 * for; optional ones wait behind a disclosure. How the reading was done —
 * taxonomy or AI, and how sure it was — is never shown; only its effect is:
 * a confident reading is prefilled, an unsure one is offered for confirmation,
 * and an unreadable one becomes a direct question.
 */
export function CommerceEntryPanel({
  entry,
  index,
  idPrefix,
  label,
  placeholder,
  hint,
  attributeErrors,
  categoryError,
  textError,
}: {
  entry: CommerceEntry;
  index: CommerceTaxonomyIndex | null;
  idPrefix: string;
  label: string;
  placeholder: string;
  hint?: string;
  attributeErrors?: Record<string, string | undefined>;
  categoryError?: string;
  textError?: string;
}) {
  const [changing, setChanging] = React.useState(false);
  const [showOptional, setShowOptional] = React.useState(false);

  const needsDirectChoice =
    entry.interpreted &&
    (entry.failed || !entry.categoryId || entry.confidence === 'LOW' || entry.isFallback);
  const pickerOpen = changing || needsDirectChoice;

  const required = entry.fields.filter((field) => field.required);
  const optional = entry.fields.filter((field) => !field.required);
  const optionalFilled = optional.some((field) => entry.attributes[field.key] !== undefined);

  return (
    <div className="space-y-4">
      <WizardField label={label} htmlFor={`${idPrefix}-text`} hint={hint} error={textError ?? null}>
        <div className="space-y-2">
          <Textarea
            id={`${idPrefix}-text`}
            value={entry.text}
            rows={2}
            maxLength={500}
            placeholder={placeholder}
            aria-invalid={Boolean(textError) || undefined}
            onChange={(event) => entry.setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && entry.text.trim().length >= 2) {
                event.preventDefault();
                entry.interpret();
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant={entry.interpreted ? 'outline' : 'default'}
              disabled={entry.text.trim().length < 2 || entry.interpreting}
              onClick={() => entry.interpret()}
            >
              {entry.interpreting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {entry.interpreted ? 'Read again' : 'Continue'}
            </Button>
          </div>
        </div>
      </WizardField>

      {entry.interpreted ? (
        <section
          aria-live="polite"
          className="space-y-4 rounded-xl border border-border bg-muted/30 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="section-label flex items-center gap-1.5">
                <Sparkles className="size-3.5" aria-hidden />
                {entry.failed
                  ? 'Choose a category'
                  : needsDirectChoice
                    ? 'What is it?'
                    : 'Detected'}
              </p>
              {entry.path.length > 0 && !needsDirectChoice ? (
                <p className="text-sm font-medium">{entry.path.join(' › ')}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {entry.failed
                    ? 'Saarthi could not read that just now. Pick the category below.'
                    : 'Saarthi could not tell what this is. Pick the closest category, or Other.'}
                </p>
              )}
              {entry.confidence === 'MEDIUM' && !changing ? (
                <p className="text-xs text-muted-foreground">Is this right? Change it if not.</p>
              ) : null}
            </div>
            {!needsDirectChoice ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setChanging((open) => !open)}
              >
                <Pencil className="size-3.5" />
                {changing ? 'Done' : 'Change'}
              </Button>
            ) : null}
          </div>

          {entry.alternatives.length > 0 && !changing ? (
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Other possible categories"
            >
              {entry.alternatives.map((alternative) => (
                <Button
                  key={alternative.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => entry.chooseCategory(alternative.id)}
                >
                  {alternative.path.map((node) => node.name).join(' › ')}
                </Button>
              ))}
            </div>
          ) : null}

          {pickerOpen && index ? (
            <WizardField
              label="Category"
              htmlFor={`${idPrefix}-category`}
              required
              error={categoryError ?? null}
            >
              <CategoryPicker
                id={`${idPrefix}-category`}
                index={index}
                value={entry.categoryId}
                invalid={Boolean(categoryError)}
                onChange={(next) => {
                  entry.chooseCategory(next);
                  setChanging(false);
                }}
              />
            </WizardField>
          ) : null}

          {Object.keys(entry.attributes).length > 0 ? (
            <div className="flex flex-wrap gap-1.5" aria-label="Detected details">
              {entry.fields
                .filter((field) => entry.attributes[field.key] !== undefined)
                .map((field) => (
                  <Badge key={field.key} variant="outline">
                    {field.label}: {formatValue(entry.attributes[field.key]!, field.unit)}
                  </Badge>
                ))}
            </div>
          ) : null}

          <AttributeFields
            fields={required}
            values={entry.attributes}
            onChange={entry.setAttribute}
            errors={attributeErrors}
            idPrefix={idPrefix}
          />

          {optional.length > 0 ? (
            showOptional || optionalFilled ? (
              <AttributeFields
                fields={optional}
                values={entry.attributes}
                onChange={entry.setAttribute}
                errors={attributeErrors}
                idPrefix={idPrefix}
              />
            ) : (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() => setShowOptional(true)}
              >
                Add more details (optional)
              </Button>
            )
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function formatValue(value: string | number | boolean, unit: string | null): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return unit && typeof value === 'number' ? `${value} ${unit}` : String(value);
}
