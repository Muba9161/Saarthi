import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Permission, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { DriverScoreDetail } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';

/**
 * Explainable score view: the weighted radar, the trend, and the exact events
 * that moved the number — every one of them carrying its reason.
 */
export function ScoreBreakdown({ score, driverId }: { score: DriverScoreDetail; driverId: string }) {
  const { can } = useAuth();
  const [adjustOpen, setAdjustOpen] = React.useState(false);

  const radarData = Object.entries(score.categories).map(([category, value]) => ({
    category: humanizeEnum(category),
    value,
  }));

  const trendData = score.history.map((entry) => ({
    date: new Date(entry.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    score: entry.overall,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <SectionHeader
              title="Score by category"
              description="Weighted: safety 30%, reliability 20%, timeliness 20%, compliance 15%, vehicle care 15%."
            />
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis
                  dataKey="category"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                />
                <Radar
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.25}
                />
                <ChartTooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>

            <div className="mt-2 space-y-2">
              {Object.entries(score.categories).map(([category, value]) => (
                <div key={category} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    {humanizeEnum(category)}
                  </span>
                  <Progress value={value} className="h-1.5 flex-1" />
                  <span className="tabular w-8 text-right text-xs font-medium">{value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <SectionHeader title="Score over time" />
          </CardHeader>
          <CardContent className="pt-0">
            {trendData.length < 2 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Not enough history yet — the trend appears after a few score events.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={30} />
                  <ChartTooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}

            {score.recommendations.length > 0 ? (
              <div className="mt-3 space-y-1.5 rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium">How to improve</p>
                {score.recommendations.map((recommendation) => (
                  <p key={recommendation} className="text-xs text-muted-foreground">
                    • {recommendation}
                  </p>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            title="What changed the score"
            description="Every adjustment carries the reason that produced it."
            actions={
              can(Permission.DRIVERS_SCORE_ADJUST) ? (
                <Button variant="outline" size="sm" onClick={() => setAdjustOpen(true)}>
                  <SlidersHorizontal className="size-4" />
                  Manual adjustment
                </Button>
              ) : null
            }
          />
        </CardHeader>
        <CardContent className="pt-0">
          {score.recentEvents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No score events recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {score.recentEvents.map((event) => (
                <li key={event.id} className="flex items-start gap-3 py-2.5">
                  <span
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                      event.points >= 0
                        ? 'bg-success/12 text-success'
                        : 'bg-destructive/12 text-destructive'
                    }`}
                  >
                    {event.points >= 0 ? <Plus className="size-3" /> : <Minus className="size-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{event.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanizeEnum(event.category)} · {relativeTimeFrom(event.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`tabular shrink-0 text-sm font-medium ${
                      event.points >= 0 ? 'text-success' : 'text-destructive'
                    }`}
                  >
                    {event.points > 0 ? '+' : ''}
                    {event.points}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} driverId={driverId} />
    </div>
  );
}

function AdjustDialog({
  open,
  onOpenChange,
  driverId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = React.useState('SAFETY');
  const [points, setPoints] = React.useState(0);
  const [reason, setReason] = React.useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/drivers/${driverId}/score/adjust`, { category, points, reason }),
    onSuccess: () => {
      toast.success('Score adjusted', { description: 'The reason is recorded on the driver profile.' });
      void queryClient.invalidateQueries({ queryKey: ['driver', driverId] });
      onOpenChange(false);
      setPoints(0);
      setReason('');
    },
    onError: (error) => toast.error('Could not adjust score', { description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust driver score</DialogTitle>
          <DialogDescription>
            Manual adjustments are audited and shown to the driver with your reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['SAFETY', 'RELIABILITY', 'TIMELINESS', 'COMPLIANCE', 'VEHICLE_CARE'].map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {humanizeEnum(entry)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label required>Points (−25 to +25)</Label>
            <Input
              type="number"
              min={-25}
              max={25}
              value={points}
              onChange={(event) => setPoints(Number(event.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label required>Reason</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain what happened, in a sentence the driver will understand."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 10 || points === 0}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Apply adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
