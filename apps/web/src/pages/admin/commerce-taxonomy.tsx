import * as React from 'react';
import { Plus } from 'lucide-react';
import { Permission, relativeTimeFrom } from '@saarthi/shared';
import type { AdminCommerceCategory, CommerceOtherUsageEntry } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { CategoryEditor } from '@/features/commerce/admin/category-editor';
import { TaxonomyTree } from '@/features/commerce/admin/taxonomy-tree';
import {
  taxonomyApi,
  useAdminTaxonomy,
  useOtherUsage,
  useTaxonomyMutation,
} from '@/features/commerce/admin/use-taxonomy-admin';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnauthorizedState,
} from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Product categories — the shared taxonomy behind every Seller product and
 * customer requirement.
 *
 * Only platform administrators edit it. Adding a node, a detail or an alias
 * here changes what the engine understands and what the forms ask for, with
 * no release; the "Other" tab shows what people sold or asked for that the
 * taxonomy did not recognise, which is where the next category comes from.
 */
export function AdminCommerceTaxonomyPage() {
  const { can } = useAuth();
  const allowed = can(Permission.ADMIN_PLATFORM);
  const taxonomy = useAdminTaxonomy(allowed);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [rootName, setRootName] = React.useState('');
  const createRoot = useTaxonomyMutation(taxonomyApi.createCategory, 'Category added');

  if (!allowed) return <UnauthorizedState />;

  const nodes = taxonomy.data ?? [];
  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform"
        title="Product categories"
        description="What sellers can sell and customers can ask for. One seller account sells across any of these."
      />

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="other">Filed under Other</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="mt-4">
          {taxonomy.isLoading ? (
            <LoadingState label="Loading categories…" />
          ) : taxonomy.error ? (
            <ErrorState error={taxonomy.error} onRetry={() => void taxonomy.refetch()} />
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
              <Card>
                <CardContent className="space-y-4 p-4">
                  <TaxonomyTree nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} />
                  <form
                    className="flex gap-2 border-t border-border pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createRoot.mutate(
                        { name: rootName.trim() },
                        {
                          onSuccess: (created) => {
                            setRootName('');
                            setSelectedId(created.id);
                          },
                        },
                      );
                    }}
                  >
                    <Input
                      aria-label="New top-level category"
                      value={rootName}
                      maxLength={80}
                      onChange={(event) => setRootName(event.target.value)}
                      placeholder="New top-level category"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      aria-label="Add top-level category"
                      disabled={rootName.trim().length < 2 || createRoot.isPending}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5">
                  {selected ? (
                    <CategoryEditor
                      key={selected.id}
                      category={selected}
                      path={pathOf(nodes, selected)}
                      onCreated={setSelectedId}
                    />
                  ) : (
                    <EmptyState
                      title="Choose a category"
                      description="Pick one on the left to edit its details, aliases and the categories inside it."
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="other" className="mt-4">
          <OtherUsage />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function pathOf(nodes: AdminCommerceCategory[], node: AdminCommerceCategory): string[] {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const path: string[] = [];
  let current: AdminCommerceCategory | undefined = node;
  while (current && path.length < 20) {
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function OtherUsage() {
  const [page, setPage] = React.useState(1);
  const query = useOtherUsage(true, page);

  const columns: Column<CommerceOtherUsageEntry>[] = [
    {
      key: 'name',
      header: 'What they called it',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.details ? (
            <p className="truncate text-xs text-muted-foreground">{row.details}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'From',
      cell: (row) => (
        <Badge variant={row.kind === 'PRODUCT' ? 'outline' : 'info'}>
          {row.kind === 'PRODUCT' ? 'Seller product' : 'Customer need'}
        </Badge>
      ),
    },
    {
      key: 'when',
      header: 'When',
      hideOnMobile: true,
      cell: (row) => relativeTimeFrom(row.createdAt),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={query.data?.items}
      rowKey={(row) => `${row.kind}-${row.id}`}
      isLoading={query.isLoading || query.isFetching}
      error={query.error}
      onRetry={() => void query.refetch()}
      {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
      onPageChange={setPage}
      emptyTitle="Nothing filed under Other"
    />
  );
}

export default AdminCommerceTaxonomyPage;
