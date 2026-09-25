import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { CommerceAttributeScope, CommerceAttributeType, humanizeEnum } from '@saarthi/shared';
import type { AdminCommerceCategory } from '@/lib/api-types';
import { WizardField, WizardSection } from '@/components/common/form-wizard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { taxonomyApi, useTaxonomyMutation } from './use-taxonomy-admin';

const SCOPE_LABELS: Record<CommerceAttributeScope, string> = {
  BOTH: 'Sellers and customers',
  PRODUCT: 'Sellers only',
  REQUIREMENT: 'Customers only',
};

/** Turns a label into the stable key its values are stored under. */
function keyFor(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'a_$1')
    .slice(0, 40);
}

/**
 * The attribute schema of one node. Children inherit these; a child that
 * declares the same key overrides the inherited definition.
 */
export function AttributeEditor({ category }: { category: AdminCommerceCategory }) {
  const [label, setLabel] = React.useState('');
  const [type, setType] = React.useState<CommerceAttributeType>(CommerceAttributeType.TEXT);
  const [unit, setUnit] = React.useState('');
  const [options, setOptions] = React.useState('');
  const [scope, setScope] = React.useState<CommerceAttributeScope>(CommerceAttributeScope.BOTH);
  const [required, setRequired] = React.useState(false);

  const create = useTaxonomyMutation(taxonomyApi.createAttribute, 'Detail added');
  const update = useTaxonomyMutation(taxonomyApi.updateAttribute, 'Detail updated');
  const remove = useTaxonomyMutation(taxonomyApi.deleteAttribute, 'Detail removed');

  const optionList = options
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
  const canAdd =
    label.trim().length >= 2 && (type !== CommerceAttributeType.SELECT || optionList.length > 0);

  const reset = (): void => {
    setLabel('');
    setUnit('');
    setOptions('');
    setRequired(false);
  };

  return (
    <WizardSection
      title="Details asked for"
      description="The form sellers and customers see is built from these. Required details are asked for until given."
    >
      {category.attributes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No details of its own - it uses its parent's.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {category.attributes.map((attribute) => (
            <li
              key={attribute.id}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">
                  {attribute.label}
                  {attribute.unit ? (
                    <span className="text-muted-foreground"> ({attribute.unit})</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <code>{attribute.key}</code> · {humanizeEnum(attribute.type)}
                  {attribute.options.length > 0 ? ` · ${attribute.options.join(', ')}` : ''} ·{' '}
                  {SCOPE_LABELS[attribute.scope]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={attribute.required}
                    aria-label={`${attribute.label} is required`}
                    onCheckedChange={(checked) =>
                      update.mutate({ id: attribute.id, required: checked })
                    }
                  />
                  Required
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${attribute.label}`}
                  onClick={() => remove.mutate(attribute.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-3 rounded-lg border border-dashed border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            {
              categoryId: category.id,
              key: keyFor(label),
              label: label.trim(),
              type,
              required,
              scope,
              ...(unit.trim() ? { unit: unit.trim() } : {}),
              ...(type === CommerceAttributeType.SELECT ? { options: optionList } : {}),
            },
            { onSuccess: reset },
          );
        }}
      >
        <p className="text-sm font-medium">Add a detail</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <WizardField label="Label" htmlFor="attribute-label">
            <Input
              id="attribute-label"
              value={label}
              maxLength={60}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Wood type"
            />
          </WizardField>
          <WizardField label="Kind of answer" htmlFor="attribute-type">
            <Select value={type} onValueChange={(next) => setType(next as CommerceAttributeType)}>
              <SelectTrigger id="attribute-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CommerceAttributeType.TEXT}>Text</SelectItem>
                <SelectItem value={CommerceAttributeType.NUMBER}>Number</SelectItem>
                <SelectItem value={CommerceAttributeType.SELECT}>Choice from a list</SelectItem>
                <SelectItem value={CommerceAttributeType.BOOLEAN}>Yes / no</SelectItem>
              </SelectContent>
            </Select>
          </WizardField>
          {type === CommerceAttributeType.SELECT ? (
            <WizardField label="Options" htmlFor="attribute-options" hint="Separate with commas.">
              <Input
                id="attribute-options"
                value={options}
                onChange={(event) => setOptions(event.target.value)}
                placeholder="Teak, Sal, Sheesham"
              />
            </WizardField>
          ) : null}
          {type === CommerceAttributeType.NUMBER ? (
            <WizardField
              label="Unit"
              htmlFor="attribute-unit"
              hint='Written after the number, e.g. "mm".'
            >
              <Input
                id="attribute-unit"
                value={unit}
                maxLength={20}
                onChange={(event) => setUnit(event.target.value)}
              />
            </WizardField>
          ) : null}
          <WizardField label="Asked of" htmlFor="attribute-scope">
            <Select
              value={scope}
              onValueChange={(next) => setScope(next as CommerceAttributeScope)}
            >
              <SelectTrigger id="attribute-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(CommerceAttributeScope).map((value) => (
                  <SelectItem key={value} value={value}>
                    {SCOPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={required} onCheckedChange={setRequired} />
            Required
          </label>
          <Button type="submit" size="sm" disabled={!canAdd || create.isPending}>
            Add detail
          </Button>
        </div>
        {label.trim() ? (
          <p className="text-xs text-muted-foreground">
            Stored as{' '}
            <Badge variant="muted" size="sm">
              {keyFor(label)}
            </Badge>
            . The key cannot be changed later.
          </p>
        ) : null}
      </form>
    </WizardSection>
  );
}
