import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';
import type { AdminCommerceCategory, CommerceOtherUsageEntry, Paginated } from '@/lib/api-types';
import { COMMERCE_CATEGORIES_KEY } from '../use-commerce';

export const ADMIN_TAXONOMY_KEY = ['admin', 'commerce', 'categories'] as const;

export function useAdminTaxonomy(enabled: boolean) {
  return useQuery({
    queryKey: ADMIN_TAXONOMY_KEY,
    queryFn: () => api.get<AdminCommerceCategory[]>('/admin/commerce/categories'),
    enabled,
  });
}

export function useOtherUsage(enabled: boolean, page: number) {
  return useQuery({
    queryKey: ['admin', 'commerce', 'other-usage', page],
    queryFn: () =>
      api.get<Paginated<CommerceOtherUsageEntry>>('/admin/commerce/other-usage', {
        page,
        pageSize: 20,
      }),
    enabled,
  });
}

/**
 * One mutation shape for every taxonomy write: call the endpoint, refresh the
 * admin tree and the tree sellers and customers pick from, and say so.
 */
export function useTaxonomyMutation<TInput, TResult>(
  request: (input: TInput) => Promise<TResult>,
  success: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_TAXONOMY_KEY });
      void queryClient.invalidateQueries({ queryKey: COMMERCE_CATEGORIES_KEY });
      toast.success(success);
    },
    onError: (error) =>
      toast.error('That change was not saved', { description: errorMessage(error) }),
  });
}

export const taxonomyApi = {
  createCategory: (input: { parentId?: string; name: string; defaultUnit?: string }) =>
    api.post<{ id: string }>('/admin/commerce/categories', input),
  updateCategory: ({
    id,
    ...input
  }: {
    id: string;
    name?: string;
    status?: string;
    defaultUnit?: string | null;
  }) => api.patch(`/admin/commerce/categories/${id}`, input),
  createAttribute: ({ categoryId, ...input }: { categoryId: string } & Record<string, unknown>) =>
    api.post(`/admin/commerce/categories/${categoryId}/attributes`, input),
  updateAttribute: ({ id, ...input }: { id: string; required?: boolean }) =>
    api.patch(`/admin/commerce/attributes/${id}`, input),
  deleteAttribute: (id: string) => api.delete(`/admin/commerce/attributes/${id}`),
  addAlias: ({ categoryId, alias }: { categoryId: string; alias: string }) =>
    api.post(`/admin/commerce/categories/${categoryId}/aliases`, { alias }),
  deleteAlias: (id: string) => api.delete(`/admin/commerce/aliases/${id}`),
};
