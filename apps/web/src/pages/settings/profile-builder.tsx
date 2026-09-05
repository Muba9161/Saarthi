import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleDot,
  Eye,
  Image as ImageIcon,
  KeyRound,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  Sparkles,
  User,
  Warehouse,
} from 'lucide-react';
import { MediaOwnerType, humanizeEnum } from '@saarthi/shared';
import type { ProfileCompletion, ProfileField, ProfileSection } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { FormWizard, type WizardStep } from '@/components/common/form-wizard';
import { useAuth } from '@/features/auth/auth-context';
import { PhotoUploader } from '@/features/media/photo-uploader';
import { useLocale } from '@/features/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
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
 * Each section still saves independently. A profile is long, people fill it in
 * over several sittings, and a single submit button at the bottom would lose
 * work — so the blueprint's sections became the wizard's steps rather than
 * being collapsed into one submission. Two consequences follow from that, and
 * both are deliberate:
 *
 *  * Drafts live on this page, not inside a step. A step that is navigated
 *    away from unmounts, and unsaved edits would go with it.
 *  * Any step can be opened from the rail. Somebody who signs in to add one
 *    phone number should not have to walk past six sections to reach it.
 */

/** The blueprint key of the language field, in `sectionKey.fieldKey` form. */
const LOCALE_FIELD_KEY = 'preferences.locale';

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

function sectionIcon(name: string): React.ComponentType<{ className?: string }> {
  return SECTION_ICONS[name] ?? CircleDot;
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
  owner,
  onChange,
  onMediaChanged,
}: {
  field: ProfileField;
  sectionKey: string;
  value: unknown;
  disabled: boolean;
  /** Who an IMAGE field's upload belongs to. Null when it cannot be resolved. */
  owner: { type: MediaOwnerType; id: string } | null;
  onChange: (next: unknown) => void;
  /** An image upload changes the completion score, which the API computes. */
  onMediaChanged: () => void;
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
            <span className="text-sm text-muted-foreground">{value === true ? 'Yes' : 'No'}</span>
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
        /*
          Uploads go through the media module, which owns the size limits and
          the magic-byte checks — the profile PATCH rejects an image id
          outright, so that a caller cannot point their avatar at somebody
          else's asset. The uploader posts to `/media` directly and the
          blueprint picks the new asset up on the next read.

          Which owner it hangs off follows the blueprint: a logo is a business
          asset, an avatar is a personal one.
        */
        if (!field.mediaPurpose || !owner) {
          return (
            <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              This image cannot be uploaded until an organization is selected.
            </div>
          );
        }
        return (
          <PhotoUploader
            ownerType={owner.type}
            ownerId={owner.id}
            purpose={field.mediaPurpose}
            label={field.label}
            description={field.help}
            max={1}
            requiredCount={field.required ? 1 : undefined}
            disabled={disabled}
            onChanged={onMediaChanged}
          />
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

  // The uploader carries its own heading, count and help text, so wrapping it
  // in the standard label block would print the field name twice.
  if (field.kind === 'IMAGE') return control;

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

/**
 * The fields of one section, plus its own save controls.
 *
 * The draft is owned by the page above, so leaving this step and coming back
 * finds the edits still there. Saving is still per section — the wizard's
 * footer navigates, it does not submit the profile.
 */
function SectionFields({
  section,
  view,
  draft,
  userId,
  onDraftChange,
  onDiscard,
  onSaved,
}: {
  section: ProfileSection;
  view: BuilderView;
  draft: Record<string, unknown>;
  /** Owner of personal media — an avatar belongs to the person, not the company. */
  userId: string | null;
  onDraftChange: (key: string, value: unknown) => void;
  onDiscard: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/profile/builder/${section.key}`, {
        // Only the fields actually touched are sent, so a section save cannot
        // blank a field the user never opened.
        values: draft,
      }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      onDiscard();
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
    <div className="space-y-4">
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
                owner={
                  field.organizationScoped
                    ? view.organizationId
                      ? { type: MediaOwnerType.ORGANIZATION, id: view.organizationId }
                      : null
                    : userId
                      ? { type: MediaOwnerType.USER, id: userId }
                      : null
                }
                onChange={(next) => {
                  onDraftChange(key, next);
                  setSaved(false);
                }}
                onMediaChanged={onSaved}
              />
            </div>
          );
        })}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center justify-end gap-2 border-t border-white/40 pt-3 dark:border-white/[0.06]">
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        ) : null}
        {dirty ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
            Discard
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save section
        </Button>
      </div>
    </div>
  );
}

/**
 * Change your password.
 *
 * This is the one part of the old Settings screen that the blueprint does not
 * describe, and could not: a password is not a profile field, it is never read
 * back, and it goes to `/auth/change-password` rather than the profile PATCH.
 * It is a hand-written step appended after the blueprint's own.
 */
function SecurityStep() {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast.success('Password changed', { description: 'Other devices have been signed out.' });
      setCurrentPassword('');
      setNewPassword('');
      setError(null);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : 'That password could not be changed.',
      );
    },
  });

  const ready = currentPassword.length > 0 && newPassword.length >= 10;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Changing your password signs out every other device.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              setError(null);
            }}
          />
          <p className="text-2xs text-muted-foreground">
            At least 10 characters, with upper case, lower case and a number.
          </p>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end border-t border-white/40 pt-3 dark:border-white/[0.06]">
        <Button
          type="button"
          size="sm"
          disabled={!ready}
          loading={change.isPending}
          onClick={() => change.mutate()}
        >
          Change password
        </Button>
      </div>
    </div>
  );
}

export function ProfileBuilderPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { session, refreshSession } = useAuth();
  const { setLocale } = useLocale();
  /** Keyed by section key, then by `sectionKey.fieldKey`. */
  const [drafts, setDrafts] = React.useState<Record<string, Record<string, unknown>>>({});

  const builder = useQuery({
    queryKey: ['profile', 'builder'],
    queryFn: () => api.get<BuilderView>('/profile/builder'),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
    // A profile photo is mirrored onto the user record, and the app shell
    // reads it from the session rather than re-fetching it per render. Without
    // this the new photograph does not appear in the header until a reload.
    void refreshSession();
  }

  if (builder.isLoading) return <LoadingState label="Loading your profile…" />;
  if (builder.error) {
    return <ErrorState error={builder.error} onRetry={() => void builder.refetch()} />;
  }
  if (!builder.data) return <ErrorState error={new Error('Profile unavailable')} />;

  const view = builder.data;
  const { completion } = view;

  const percentOf = (sectionKey: string): number =>
    completion.sections.find((entry) => entry.key === sectionKey)?.percent ?? 0;

  const steps: WizardStep[] = view.sections.map((section) => ({
    id: section.key,
    title: section.title,
    description: `${percentOf(section.key)}% complete`,
    icon: sectionIcon(section.icon),
    content: (
      <>
        {section.description ? (
          <p className="text-sm text-muted-foreground">{section.description}</p>
        ) : null}
        <SectionFields
          section={section}
          view={view}
          userId={session?.user.id ?? null}
          draft={drafts[section.key] ?? {}}
          onDraftChange={(key, value) => {
            // The language is the one preference that changes this screen
            // while you are looking at it. Waiting for "Save section" would
            // leave someone who just fixed their language reading a form
            // still in the wrong one; `setLocale` applies and stores it, and
            // the section save then writes the same value harmlessly.
            if (key === LOCALE_FIELD_KEY && typeof value === 'string') setLocale(value);

            setDrafts((previous) => ({
              ...previous,
              [section.key]: { ...(previous[section.key] ?? {}), [key]: value },
            }));
          }}
          onDiscard={() =>
            setDrafts((previous) => {
              const next = { ...previous };
              delete next[section.key];
              return next;
            })
          }
          onSaved={refresh}
        />
      </>
    ),
  }));

  // Security is not part of the blueprint — see `SecurityStep`. It goes last
  // because it is the one step that is not about completing the profile.
  steps.push({
    id: 'security',
    title: 'Security',
    description: 'Your password.',
    icon: KeyRound,
    content: <SecurityStep />,
  });

  const organization = session?.organization;

  const progressAside = (
    <div className="space-y-3">
      <div className="glass-inset space-y-2 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">Profile completion</span>
          <span className="tabular-nums text-muted-foreground">{completion.percent}%</span>
        </div>
        <Progress
          value={completion.percent}
          className="h-1.5"
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
        <div className="glass-inset space-y-1.5 border-primary/30 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="size-3.5 shrink-0 text-primary" />
            Next: {completion.nextBestAction.fieldLabel}
          </p>
          <p className="text-2xs leading-relaxed text-muted-foreground">
            in {completion.nextBestAction.sectionTitle} · worth{' '}
            {completion.nextBestAction.worthPercent}% more
          </p>
        </div>
      ) : (
        <div className="glass-inset flex items-center gap-2 p-3 text-xs">
          <Check className="size-3.5 shrink-0 text-success" />
          <span>Your profile is complete.</span>
        </div>
      )}

      {/*
        The facts about this account that are not editable here — the sign-in
        address, and which organization the session is acting for. They used to
        be read-only cards on the Settings screen; they belong beside the
        profile rather than on a page of their own.
      */}
      <div className="glass-inset space-y-2 p-3">
        <p className="section-label">Account</p>
        <dl className="space-y-1.5 text-2xs">
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">Email</dt>
            <dd className="min-w-0 truncate text-right font-medium">{session?.user.email}</dd>
          </div>
          {organization ? (
            <>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">Organization</dt>
                <dd className="min-w-0 truncate text-right font-medium">{organization.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">Your role</dt>
                <dd className="min-w-0 truncate text-right">
                  {humanizeEnum(organization.membershipRole)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">Verification</dt>
                <dd className="min-w-0">
                  <Badge
                    variant={
                      organization.verificationStatus === 'VERIFIED' ? 'success' : 'warning'
                    }
                    size="sm"
                  >
                    {humanizeEnum(organization.verificationStatus)}
                  </Badge>
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>
    </div>
  );

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

      <FormWizard
        steps={steps}
        title="Your profile"
        description="Each section saves on its own — you can stop and come back."
        aside={progressAside}
        allowJumpAhead
        // Nothing is submitted here — each section has already saved itself —
        // so the last step's button leaves rather than pretending to write.
        // Verification is what a completed profile is for.
        onSubmit={() => navigate('/verification')}
        submitLabel={
          <>
            Done
            <ArrowRight className="size-4" />
          </>
        }
      />

      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          VorldX Saarthi has no public profile pages. What you enter here is visible to signed-in
          Saarthi businesses you deal with, and to platform staff reviewing your verification —
          never to the open internet.
        </CardContent>
      </Card>
    </div>
  );
}

export default ProfileBuilderPage;
