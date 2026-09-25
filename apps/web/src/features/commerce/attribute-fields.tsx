import {
  type CommerceAttributeDefinition,
  type CommerceAttributeValue,
  type CommerceAttributeValues,
  CommerceAttributeType,
} from '@saarthi/shared';
import { WizardField } from '@/components/common/form-wizard';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The form a category's schema asks for, rendered from data.
 *
 * There is no per-category UI anywhere: a furniture listing and a sand listing
 * differ only in the attribute rows the taxonomy holds for them, so a new
 * category an administrator adds gets its form without a release.
 */
export function AttributeFields({
  fields,
  values,
  onChange,
  errors,
  idPrefix,
}: {
  fields: CommerceAttributeDefinition[];
  values: CommerceAttributeValues;
  onChange: (key: string, value: CommerceAttributeValue | undefined) => void;
  /** Keyed by attribute key. */
  errors?: Record<string, string | undefined>;
  idPrefix: string;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <AttributeField
          key={field.key}
          field={field}
          id={`${idPrefix}-${field.key}`}
          value={values[field.key]}
          error={errors?.[field.key]}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </div>
  );
}

function AttributeField({
  field,
  id,
  value,
  error,
  onChange,
}: {
  field: CommerceAttributeDefinition;
  id: string;
  value: CommerceAttributeValue | undefined;
  error: string | undefined;
  onChange: (value: CommerceAttributeValue | undefined) => void;
}) {
  if (field.type === CommerceAttributeType.BOOLEAN) {
    return (
      <div className="flex items-center gap-3 self-end rounded-lg border border-border p-3">
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {field.label}
        </label>
      </div>
    );
  }

  const label =
    field.unit && field.type === CommerceAttributeType.NUMBER
      ? `${field.label} (${field.unit})`
      : field.label;

  return (
    <WizardField label={label} htmlFor={id} required={field.required} error={error ?? null}>
      {field.type === CommerceAttributeType.SELECT ? (
        <Select
          value={typeof value === 'string' ? value : undefined}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger id={id} aria-invalid={Boolean(error) || undefined}>
            <SelectValue placeholder={`Choose ${field.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={field.type === CommerceAttributeType.NUMBER ? 'number' : 'text'}
          inputMode={field.type === CommerceAttributeType.NUMBER ? 'decimal' : undefined}
          min={field.validation?.min}
          max={field.validation?.max}
          maxLength={field.validation?.maxLength ?? 120}
          value={value === undefined ? '' : String(value)}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') onChange(undefined);
            else onChange(field.type === CommerceAttributeType.NUMBER ? Number(raw) : raw);
          }}
        />
      )}
    </WizardField>
  );
}
