import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { humanizeEnum } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

export function SettingsPage() {
  const { session, refreshSession } = useAuth();
  const [firstName, setFirstName] = React.useState(session?.user.firstName ?? '');
  const [lastName, setLastName] = React.useState(session?.user.lastName ?? '');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');

  const saveProfile = useMutation({
    mutationFn: () => api.patch('/auth/me', { firstName, lastName }),
    onSuccess: async () => { toast.success('Profile updated'); await refreshSession(); },
    onError: (error) => toast.error('Could not save', { description: errorMessage(error) }),
  });

  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => { toast.success('Password changed', { description: 'Other devices have been signed out.' }); setCurrentPassword(''); setNewPassword(''); },
    onError: (error) => toast.error('Could not change password', { description: errorMessage(error) }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Settings" description="Your profile, security and organization." />

      <Card>
        <CardHeader className="pb-3"><SectionHeader title="Profile" /></CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>First name</Label><Input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Last name</Label><Input value={lastName} onChange={(event) => setLastName(event.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={session?.user.email ?? ''} disabled /></div>
          <Button loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Save profile</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><SectionHeader title="Password" description="Changing your password signs out every other device." /></CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="space-y-1.5"><Label>Current password</Label><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></div>
          <div className="space-y-1.5"><Label>New password</Label><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></div>
          <Button disabled={!currentPassword || newPassword.length < 10} loading={changePassword.isPending} onClick={() => changePassword.mutate()}>Change password</Button>
        </CardContent>
      </Card>

      {session?.organization ? (
        <Card>
          <CardHeader className="pb-3"><SectionHeader title="Organization" /></CardHeader>
          <CardContent className="space-y-2 pt-0 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{session.organization.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{humanizeEnum(session.organization.type)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Your role</span><span>{humanizeEnum(session.organization.membershipRole)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Verification</span><Badge variant={session.organization.verificationStatus === 'VERIFIED' ? 'success' : 'warning'} size="sm">{humanizeEnum(session.organization.verificationStatus)}</Badge></div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default SettingsPage;
