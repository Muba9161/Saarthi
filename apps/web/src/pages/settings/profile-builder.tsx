import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleAlert,
  CircleDot,
  Eye,
  Image as ImageIcon,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  Sparkles,
  User,
  Warehouse,
} from 'lucide-react';
import type { ProfileCompletion, ProfileField, ProfileSection } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Profile builder.
 *
 * The form is not written here — it is *described* by the API. `GET
 * /profile/builder` returns a blueprint (sections, fields, kinds, options)
 * chosen for the caller's audience, the current values, and a completion score.
 * This screen renders whatever it is given.
 *
 * That indirection is the point: a driver, a fleet owner and a supplier need
 * different profiles, and the shape of each is a domain decision that belongs
 * next to the verification rules that consume it — not duplicated in a React
 * form that will drift from them.
 *
 * Each section saves independently. A profile is long, people fill it in over
 * several sittings, and a single submit button at the bottom would lose work.
 */

interface BuilderView {
  audience: string;
  sections: ProfileSection[];
  /** Keyed `sectionKey.fieldKey`. */
  values: Record<string, unknown>;
  completion: ProfileCompletion;
  canEditOrganization: boolean;
  organizationId: string | null;
}

/**
 * Blueprint icon names, resolved against an explicit map.
 *
 * Deliberately not `import * as Icons from 'lucide-react'` with a dynamic
 * lookup: that defeats tree-shaking and pulls the entire icon set into this
 * chunk — measured at ~750 kB for one screen. The blueprint uses a small fixed
 * set, so listing them costs one line each and an unknown name falls back.
 */
const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BadgeCheck,
  Eye,
  Image: ImageIcon,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  User,
  Warehouse,
};

function SectionIcon({ name, className }: { name: string; className?: string }) {
  const Icon = SECTION_ICONS[name] ?? CircleDot;
  return <Icon className={className} />;
}

function fieldValueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return '';
}

/** One blueprint field, rendered according to its declared kind. */
function FieldControl({
  field,
  sectionKey,
  value,
  disabled,
  onChange,
}: {
  field: ProfileField;
  sectionKey: string;
  value: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
}) {
  const id = `${sectionKey}.${field.key}`;
  const text = fieldValueToString(value);

  const control = (() => {
    switch (field.kind) {
      case 'TEXTAREA':
        return (
          <Textarea
            id={id}
            rows={3}
            value={text}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        );

      case 'SELECT':
        return (
          <Select
            value={text || '__none__'}
            disabled={disabled}
            onValueChange={(next) => onChange(next === '__none__' ? null : next)}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder={field.placeholder ?? 'Choose one'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not set</SelectItem>
              {(field.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'BOOLEAN':
        return (
          <div className="flex items-center gap-2 pt-1">
            <Switch
              id={id}
              checked={value === true}
              disabled={disabled}
              onCheckedChange={(next) => onChange(next)}
            />
            <span className="text-sm text-muted-foreground">
              {value === true ? 'Yes' : 'No'}
            </span>
          </div>
        );

      case 'NUMBER':
        return (
          <Input
            id={id}
            type="number"
            min={field.min}
            max={field.max}
            value={text}
            placeholder={field.placeholder}
            disabled={disabled}
            onChange={(event) =>
              onChange(event.target.value === '' ? null : Number(event.target.value))
            }
          />
        );

      case 'DATE':
        return (
          <Input
            id={id}
            type="date"
            value={text.slice(0, 10)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value || null)}
          />
        );

      case 'IMAGE':
        // Uploads go through the media module, which owns validation and
        // storage. Showing a text field for a storage key would invite someone
        // to paste something that is not an image.
        return (
          <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            {text ? 'An image has been uploaded.' : 'No image yet.'}
            <p className="mt-1 text-2xs">
              Images are managed from the media library so they can be validated
              and resized.
            </p>
          </div>
        );

      case 'EMAIL':
        return (
          <Input
            id={id}
            type="email"
            value={text}
            placeholder={field.placeholder}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        );

      case 'PHONE':
        return (
          <Input
            id={id}
            type="tel"
            value={text}
            placeholder={field.placeholder ?? '9876543210'}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        );

      default:
        return (
          <Input
            id={id}
            value={text}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  })();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {field.label}
        {field.required ? <span className="text-destructive">*</span> : null}
        {field.organizationScoped ? (
          <Badge variant="outline" size="sm">
            company
          </Badge>
        ) : null}
      </Label>
      {control}
      {field.help ? <p className="text-2xs text-muted-foreground">{field.help}</p> : null}
      {disabled && field.organizationScoped ? (
        <p className="text-2xs text-muted-foreground">
          Only an organization administrator can change this.
        </p>
      ) : null}
    </div>
  );
}

/** One section, with its own dirty state and save button. */
function SectionCard({
  section,
  view,
  onSaved,
}: {
  section: ProfileSection;
  view: BuilderView;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const completion = view.completion.sections.find((entry) => entry.key === section.key);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/profile/builder/${section.key}`, {
        // Only the fields actually touched are sent, so a section save cannot
        // blank a field the user never opened.
        values: draft,
      }),
    onSuccess: () => {
      setDraft({});
      setError(null);
      setSaved(true);
      onSaved();
      window.setTimeout(() => setSaved(false), 2500);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : 'That section could not be saved.',
      );
    },
  });

  const dirty = Object.keys(draft).length > 0;

  return (
    <Card id={`section-${section.key}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SectionIcon name={section.icon} className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <SectionHeader title={section.title} description={section.description} />
            </div>
          </div>
          {completion ? (
            <Badge
              variant={completion.percent === 100 ? 'success' : 'secondary'}
              size="sm"
              className="shrink-0 gap-1"
            >
              {completion.percent === 100 ? <Check className="h-3 w-3" /> : null}
              {completion.percent}%
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          {section.fields.map((field) => {
            const key = `${section.key}.${field.key}`;
            const disabled = Boolean(field.organizationScoped) && !view.canEditOrganization;
            const current = key in draft ? draft[key] : view.values[key];

            return (
              <div
                key={field.key}
                className={
                  field.kind === 'TEXTAREA' || field.kind === 'IMAGE' ? 'sm:col-span-2' : undefined
                }
              >
                <FieldControl
                  field={field}
                  sectionKey={section.key}
                  value={current}
                  disabled={disabled || save.isPending}
                  onChange={(next) => {
                    setDraft((previous) => ({ ...previous, [key]: next }));
                    setSaved(false);
                  }}
                />
              </div>
            );
          })}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          {saved ? (
            <span className="inline-flex items-center gap-1 text-sm text-success">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          ) : null}
          {dirty ? (
            <Button variant="ghost" size="sm" onClick={() => setDraft({})}>
              Discard
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save section
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfileBuilderPage() {
  const queryClient = useQueryClient();

  const builder = useQuery({
    queryKey: ['profile', 'builder'],
    queryFn: () => api.get<BuilderView>('/profile/builder'),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
  }

  if (builder.isLoading) return <LoadingState label="Loading your profile…" />;
  if (builder.error) {
    return <ErrorState error={builder.error} onRetry={() => void builder.refetch()} />;
  }
  if (!builder.data) return <ErrorState error={new Error('Profile unavailable')} />;

  const view = builder.data;
  const { completion } = view;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Account"
        title="Your profile"
        description="A complete profile is what moves an account toward verification — and what other Saarthi businesses see before they work with you."
        actions={
          <Badge variant={completion.percent === 100 ? 'success' : 'secondary'}>
            {completion.percent}% complete
          </Badge>
        }
      />

      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Profile completion</span>
              <span className="tabular-nums text-muted-foreground">{completion.percent}%</span>
            </div>
            <Progress
              value={completion.percent}
              className="h-2"
              indicatorClassName={
                completion.percent === 100
                  ? 'bg-success'
                  : completion.percent >= 60
                    ? 'bg-primary'
                    : 'bg-warning'
              }
            />
          </div>

          {completion.nextBestAction ? (
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-medium">Next: {completion.nextBestAction.fieldLabel}</p>
                <p className="text-xs text-muted-foreground">
                  in {completion.nextBestAction.sectionTitle} · worth{' '}
                  {completion.nextBestAction.worthPercent}% more
                </p>
              </div>
              <Button asChild variant="secondary" size="sm" className="shrink-0 gap-1">
                <a href={`#section-${completion.nextBestAction.sectionKey}`}>
                  Go <ArrowRight className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
              <Check className="h-4 w-4 shrink-0 text-success" />
              <span>Your profile is complete. Nothing else is outstanding.</span>
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap gap-2">
            {completion.sections.map((section) => (
              <a
                key={section.key}
                href={`#section-${section.key}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-secondary"
              >
                {section.percent === 100 ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <CircleAlert className="h-3 w-3 text-warning" />
                )}
                {section.title}
                <span className="tabular-nums text-muted-foreground">{section.percent}%</span>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {view.sections.map((section) => (
        <SectionCard key={section.key} section={section} view={view} onSaved={refresh} />
      ))}

      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          Saarthi has no public profile pages. What you enter here is visible to signed-in Saarthi
          businesses you deal with, and to platform staff reviewing your verification — never to the
          open internet.
        </CardContent>
      </Card>
    </div>
  );
}

export default ProfileBuilderPage;
