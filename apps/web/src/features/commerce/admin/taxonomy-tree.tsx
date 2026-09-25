import * as React from 'react';
import { Search } from 'lucide-react';
import { CommerceCategoryStatus } from '@saarthi/shared';
import type { AdminCommerceCategory } from '@/lib/api-types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface Row {
  node: AdminCommerceCategory;
  depth: number;
}

/** Depth-first order, so every child sits directly under its parent. */
function flatten(nodes: AdminCommerceCategory[]): Row[] {
  const children = new Map<string | null, AdminCommerceCategory[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const rows: Row[] = [];
  const visit = (parentId: string | null, depth: number): void => {
    const siblings = (children.get(parentId) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    for (const node of siblings) {
      rows.push({ node, depth });
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/** The whole taxonomy as an indented, searchable list. */
export function TaxonomyTree({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: AdminCommerceCategory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = React.useState('');
  const rows = React.useMemo(() => flatten(nodes), [nodes]);
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? rows.filter(
        ({ node }) =>
          node.name.toLowerCase().includes(needle) ||
          node.aliasEntries.some((alias) => alias.alias.includes(needle)),
      )
    : rows;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search categories"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search categories or aliases"
          className="pl-9"
        />
      </div>
      <ul className="max-h-[32rem] space-y-0.5 overflow-y-auto pr-1" aria-label="Categories">
        {visible.map(({ node, depth }) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-current={node.id === selectedId || undefined}
              style={{ paddingLeft: `${(needle ? 0 : depth) * 1 + 0.75}rem` }}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                node.id === selectedId ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                node.status === CommerceCategoryStatus.INACTIVE &&
                  'text-muted-foreground line-through',
              )}
            >
              <span className="truncate">{node.name}</span>
              <span className="flex shrink-0 items-center gap-1">
                {node.isFallback ? (
                  <Badge variant="muted" size="sm">
                    Fallback
                  </Badge>
                ) : null}
                {node.listingCount + node.requirementCount > 0 ? (
                  <span className="text-2xs tabular-nums text-muted-foreground">
                    {node.listingCount + node.requirementCount}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
