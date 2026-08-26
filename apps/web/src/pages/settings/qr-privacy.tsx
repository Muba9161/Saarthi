import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, Lock, ShieldCheck } from 'lucide-react';
import { Permission, QrPrivacyProfile } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * QR privacy settings.
 *
 * The screen is built around one honest admission: a printed QR code will be
 * scanned by people the fleet has no relationship with. Rather than pretending
 * otherwise, it shows exactly which fields answer to whom, and lets an owner
 * tighten any of them.
 *
 * Fields Saarthi never discloses — a driver's home address, the chassis and
 * engine numbers, loan amounts, FASTag balances — are shown too, marked locked.
 * Seeing that they cannot be switched on is more reassuring than not seeing
 * them at all.
 */

interface PolicyField {
  field: string;
  label: string;
  group: string;
  description: string;
  configurable: boolean;
  defaultMinProfile: QrPrivacyProfile;
  defaultMaskBelow: QrPrivacyProfile;
  maskStrategy: string;
  override: { minProfile?: QrPrivacyProfile; maskBelow?: QrPrivacyProfile; disabled?: boolean } | null;
  effectiveMinProfile: QrPrivacyProfile;
  effectiveMaskBelow: QrPrivacyProfile;
  disabled: boolean;
}

interface PolicyResponse {
  allowPublicScans: boolean;
  fields: PolicyField[];
  profiles: { profile: QrPrivacyProfile; label: string }[];
}

type Draft = Record<
  string,
  { minProfile?: QrPrivacyProfile; maskBelow?: QrPrivacyProfile; disabled?: boolean }
>;

const GROUP_ORDER = [
  'Vehicle',
  'Driver',
  'Documents',
  'Service',
  'Finance',
  'FASTag',
  'Emergency',
];

export function QrPrivacyPage(): React.ReactElement {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<Draft>({});
  const [allowPublicScans, setAllowPublicScans] = React.useState<boolean | null>(null);

  const policy = useQuery({
    queryKey: ['qr-privacy-policy'],
    queryFn: () => api.get<PolicyResponse>('/qr/privacy-policy'),
    enabled: can(Permission.QR_READ),
  });

  const save = useMutation({
    mutationFn: () =>
      api.put<PolicyResponse>('/qr/privacy-policy', {
        overrides: draft,
        ...(allowPublicScans !== null ? { allowPublicScans } : {}),
      }),
    onSuccess: () => {
      toast.success('QR privacy updated', {
        description: 'It applies to every code you have already printed.',
      });
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ['qr-privacy-policy'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Seed the local draft from what the server already holds, so a save does not
  // silently reset overrides the owner set previously and has not touched.
  React.useEffect(() => {
    if (!policy.data) return;
    const seeded: Draft = {};
    for (const field of policy.data.fields) {
      if (field.override) seeded[field.field] = { ...field.override };
    }
    setDraft(seeded);
    setAllowPublicScans(policy.data.allowPublicScans);
  }, [policy.data]);

  if (!can(Permission.QR_READ)) return <UnauthorizedState />;
  if (policy.isLoading) return <LoadingState label="Loading privacy policy…" />;
  if (policy.isError) {
    return <ErrorState error={policy.error} onRetry={() => void policy.refetch()} />;
  }

  const canManage = can(Permission.QR_MANAGE);
  const data = policy.data!;
  const profiles = data.profiles;

  const groups = GROUP_ORDER.map((group) => ({
    group,
    fields: data.fields.filter((field) => field.group === group),
  })).filter((entry) => entry.fields.length > 0);

  const update = (field: string, patch: Draft[string]): void =>
    setDraft((previous) => ({ ...previous, [field]: { ...previous[field], ...patch } }));

  const dirty =
    JSON.stringify(draft) !==
      JSON.stringify(
        Object.fromEntries(
          data.fields.filter((field) => field.override).map((field) => [field.field, field.override]),
        ),
      ) || allowPublicScans !== data.allowPublicScans;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="QR privacy"
        description="What a Saarthi QR code discloses, and to whom. Every rule here is enforced when the code is scanned — not in the app that displays the result."
        actions={
          canManage ? (
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save policy'}
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            title="Anonymous scanning"
            description="Whether a code of yours answers someone with no VorldX Saarthi account at all."
          />
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Allow public scans</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Turning this off closes anonymous scanning for every sticker you have already
                printed, without reissuing any of them. Codes still work for signed-in accounts.
              </p>
            </div>
            <Switch
              checked={allowPublicScans ?? true}
              onCheckedChange={setAllowPublicScans}
              disabled={!canManage}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <SectionHeader
            title="Who sees what"
            description="“Visible from” is the lowest access level that sees the field at all. “In full from” is where it stops being masked."
          />
        </CardHeader>
        <CardContent className="space-y-6 pt-2">
          {groups.map((entry) => (
            <div key={entry.group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {entry.group}
              </h3>
              <div className="space-y-2">
                {entry.fields.map((field) => {
                  const current = draft[field.field] ?? {};
                  const minProfile = current.minProfile ?? field.effectiveMinProfile;
                  const maskBelow = current.maskBelow ?? field.effectiveMaskBelow;
                  const disabled = current.disabled ?? field.disabled;

                  return (
                    <div
                      key={field.field}
                      className="rounded-lg border border-border p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-sm font-medium">
                            {field.label}
                            {!field.configurable ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="muted" size="sm" className="cursor-help gap-1">
                                    <Lock className="h-3 w-3" />
                                    Fixed
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  This rule is set by Saarthi and cannot be loosened. {field.description}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                            {disabled ? (
                              <Badge variant="destructive" size="sm">
                                Never shown
                              </Badge>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {field.description}
                          </p>
                        </div>

                        {field.configurable ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="w-40">
                              <label className="text-2xs uppercase tracking-wide text-muted-foreground">
                                Visible from
                              </label>
                              <Select
                                value={minProfile}
                                onValueChange={(value) =>
                                  update(field.field, { minProfile: value as QrPrivacyProfile })
                                }
                                disabled={!canManage || disabled}
                              >
                                <SelectTrigger className="mt-0.5 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {profiles.map((profile) => (
                                    <SelectItem key={profile.profile} value={profile.profile}>
                                      {profile.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="w-40">
                              <label className="text-2xs uppercase tracking-wide text-muted-foreground">
                                In full from
                              </label>
                              <Select
                                value={maskBelow}
                                onValueChange={(value) =>
                                  update(field.field, { maskBelow: value as QrPrivacyProfile })
                                }
                                disabled={!canManage || disabled || field.maskStrategy === 'NONE'}
                              >
                                <SelectTrigger className="mt-0.5 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {profiles.map((profile) => (
                                    <SelectItem key={profile.profile} value={profile.profile}>
                                      {profile.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="pt-4">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Switch
                                      checked={!disabled}
                                      onCheckedChange={(checked) =>
                                        update(field.field, { disabled: !checked })
                                      }
                                      disabled={!canManage}
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {disabled ? 'Switch the field back on' : 'Never disclose this field'}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {field.effectiveMinProfile === QrPrivacyProfile.ADMIN
                              ? 'Never disclosed by a scan'
                              : `Fleet only`}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 py-4">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">A policy can only narrow.</span> The
              scanner&rsquo;s relationship to the vehicle or driver is decided first, and this
              policy applies inside whatever that already allowed. Making a field public here does
              not expose it to someone the relationship never granted it to.
            </p>
            <p>
              Every scan is logged with who scanned, when, and what they were shown — see the scan
              history on each code.
            </p>
          </div>
        </CardContent>
      </Card>

      <Separator />
    </div>
  );
}

export default QrPrivacyPage;
