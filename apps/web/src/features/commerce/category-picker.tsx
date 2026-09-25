import * as React from 'react';
import { type CommerceTaxonomyIndex, categoryPath } from '@saarthi/shared';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * A manual choice from the taxonomy, grouped by top-level category.
 *
 * The fallback when the engine is unsure or unreachable. Every node is
 * selectable — "Sand" is a valid answer when the buyer does not care which
 * sand — so the list shows the full breadcrumb under each group.
 */
export function CategoryPicker({
  index,
  value,
  onChange,
  id,
  invalid,
}: {
  index: CommerceTaxonomyIndex;
  value: string | null;
  onChange: (categoryId: string) => void;
  id?: string;
  invalid?: boolean;
}) {
  const groups = React.useMemo(
    () =>
      (index.childrenOf.get(null) ?? []).map((root) => ({
        root,
        options: index.nodes
          .filter((node) => node.id !== root.id && categoryPath(index, node.id)[0]?.id === root.id)
          .map((node) => ({
            id: node.id,
            label: categoryPath(index, node.id)
              .slice(1)
              .map((entry) => entry.name)
              .join(' › '),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      })),
    [index],
  );

  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined}>
        <SelectValue placeholder="Choose what it is" />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {groups.map(({ root, options }) => (
          <SelectGroup key={root.id}>
            <SelectLabel>{root.name}</SelectLabel>
            <SelectItem value={root.id}>
              {root.isFallback ? root.name : `Any ${root.name.toLowerCase()}`}
            </SelectItem>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
