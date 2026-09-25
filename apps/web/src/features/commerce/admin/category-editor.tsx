import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { CommerceCategoryStatus, MaterialUnit, humanizeEnum } from '@saarthi/shared';
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
import { AttributeEditor } from './attribute-editor';
import { taxonomyApi, useTaxonomyMutation } from './use-taxonomy-admin';

const INHERIT = 'inherit';

/** Everything an administrator changes about one taxonomy node. */
export function CategoryEditor({
  category,
  path,
  onCreated,
}: {
  category: AdminCommerceCategory;
  path: string[];
  onCreated: (id: string) => void;
}) {
  const [name, setName] = React.useState(category.name);
  const [childName, setChildName] = React.useState('');
  const [alias, setAlias] = React.useState('');

  const update = useTaxonomyMutation(taxonomyApi.updateCategory, 'Category updated');
  const createChild = useTaxonomyMutation(taxonomyApi.createCategory, 'Category added');
  const addAlias = useTaxonomyMutation(taxonomyApi.addAlias, 'Alias added');
  const removeAlias = useTaxonomyMutation(taxonomyApi.deleteAlias, 'Alias removed');

  const active = category.status === CommerceCategoryStatus.ACTIVE;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="section-label">{path.slice(0, -1).join(' › ') || 'Top level'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{category.name}</h2>
          {!active ? <Badge variant="muted">Disabled</Badge> : null}
          {category.isFallback ? (
            <Badge variant="info">Fallback for unclassified goods</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {category.listingCount} listing(s) · {category.requirementCount} requirement(s)
        </p>
      </div>

      <WizardSection title="Details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <WizardField label="Name" htmlFor="category-name">
            <div className="flex gap-2">
              <Input
                id="category-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={
                  name.trim().length < 2 || name.trim() === category.name || update.isPending
                }
                onClick={() => update.mutate({ id: category.id, name: name.trim() })}
              >
                Save
              </Button>
            </div>
          </WizardField>
          <WizardField
            label="Usually sold per"
            htmlFor="category-unit"
            hint="Children inherit this unless they set their own."
          >
            <Select
              value={category.defaultUnit ?? INHERIT}
              onValueChange={(next) =>
                update.mutate({ id: category.id, defaultUnit: next === INHERIT ? null : next })
              }
            >
              <SelectTrigger id="category-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>Inherit from parent</SelectItem>
                {Object.values(MaterialUnit).map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {humanizeEnum(unit)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>
        </div>
        {!category.isFallback ? (
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Switch
              id="category-active"
              checked={active}
              disabled={update.isPending}
              onCheckedChange={(checked) =>
                update.mutate({
                  id: category.id,
                  status: checked ? CommerceCategoryStatus.ACTIVE : CommerceCategoryStatus.INACTIVE,
                })
              }
            />
            <label htmlFor="category-active" className="min-w-0 cursor-pointer space-y-0.5">
              <span className="block text-sm font-medium">Offered to sellers and customers</span>
              <span className="block text-xs text-muted-foreground">
                Turning this off hides it and everything under it from new listings and
                requirements. Existing ones keep their category.
              </span>
            </label>
          </div>
        ) : null}
      </WizardSection>

      <AttributeEditor category={category} />

      <WizardSection
        title="Aliases"
        description="Other words people use for this - the engine matches them without asking AI."
      >
        <div className="flex flex-wrap gap-1.5">
          {category.aliasEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">None yet.</p>
          ) : (
            category.aliasEntries.map((entry) => (
              <Badge key={entry.id} variant="outline" className="gap-1 pr-1">
                {entry.alias}
                <button
                  type="button"
                  aria-label={`Remove alias ${entry.alias}`}
                  className="rounded-full p-0.5 hover:bg-muted"
                  onClick={() => removeAlias.mutate(entry.id)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addAlias.mutate(
              { categoryId: category.id, alias: alias.trim() },
              { onSuccess: () => setAlias('') },
            );
          }}
        >
          <Input
            aria-label="New alias"
            value={alias}
            maxLength={60}
            onChange={(event) => setAlias(event.target.value)}
            placeholder="e.g. balu"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={alias.trim().length < 2 || addAlias.isPending}
          >
            Add
          </Button>
        </form>
      </WizardSection>

      {!category.isFallback ? (
        <WizardSection title="Add a category inside this one">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createChild.mutate(
                { parentId: category.id, name: childName.trim() },
                {
                  onSuccess: (created) => {
                    setChildName('');
                    onCreated(created.id);
                  },
                },
              );
            }}
          >
            <Input
              aria-label="New category name"
              value={childName}
              maxLength={80}
              onChange={(event) => setChildName(event.target.value)}
              placeholder="e.g. Teak Wood"
            />
            <Button type="submit" disabled={childName.trim().length < 2 || createChild.isPending}>
              <Plus className="size-4" />
              Add
            </Button>
          </form>
        </WizardSection>
      ) : null}
    </div>
  );
}
