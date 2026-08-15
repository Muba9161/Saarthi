import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { NotificationItem, Paginated } from '@/lib/api-types';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['notifications', page],
    queryFn: () => api.get<Paginated<NotificationItem>>('/notifications', { page, pageSize: 30 }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post('/notifications/read', { notificationIds: [id] }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = query.data?.items ?? [];
  const unread = items.filter((item) => !item.readAt).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Alerts about documents, trips, orders and safety."
        actions={unread > 0 ? <Button variant="outline" onClick={() => markAll.mutate()} loading={markAll.isPending}><CheckCheck className="size-4" />Mark all read</Button> : null}
      />

      {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" description="Alerts about your fleet will appear here." />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cn('truncate text-sm', item.readAt ? 'font-normal' : 'font-semibold')}>{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                  </div>
                  <div className="shrink-0 space-y-1 text-right">
                    {item.priority === 'CRITICAL' || item.priority === 'HIGH' ? (
                      <Badge variant={item.priority === 'CRITICAL' ? 'destructive' : 'warning'} size="sm">{item.priority.toLowerCase()}</Badge>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{relativeTimeFrom(item.createdAt)}</p>
                  </div>
                </div>
              </>
            );
            return (
              <Card key={item.id} className={cn('p-3.5 transition-colors', !item.readAt && 'border-primary/30 bg-primary/[0.03]')} onClick={() => !item.readAt && markOne.mutate(item.id)}>
                {item.actionUrl ? <Link to={item.actionUrl} className="block">{body}</Link> : body}
              </Card>
            );
          })}
          {query.data?.pagination.hasNextPage ? (
            <Button variant="outline" className="w-full" onClick={() => setPage((value) => value + 1)}>Load more</Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default NotificationsPage;
