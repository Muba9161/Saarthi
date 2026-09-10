import * as React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { rememberReferralCode } from '@/features/sales/referral-code';
import type { PublicReferralView } from '@/features/sales/types';
import { SaarthiLogo } from '@/components/common/logo';
import { LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Where a referral link lands.
 *
 * Public by necessity: the link is shared on WhatsApp and opened by somebody
 * with no Saarthi account and no reason to make one yet. Sending them to /login
 * would waste the salesperson's link.
 *
 * Three things this page does, and nothing else.
 *
 * **It says who invited them.** The API returns a display name and whether the
 * code is real — no phone, no email, no pipeline. A public endpoint that
 * returned more would be a public staff directory.
 *
 * **It records the visit**, so the salesperson can see their link is being
 * opened and so a signup hours later can still be credited. The capture is
 * anonymous and stores a salted hash of the caller's IP, nothing more.
 *
 * **It remembers the code locally** and carries it into registration. The code
 * in `localStorage` is a convenience, never the authority: the backend
 * re-resolves it at registration against a verified salesman profile, so an
 * invented or hand-edited code credits nobody.
 *
 * An unrecognised code still leads to signup. The referral is what failed, not
 * the signup — turning a mistyped link into a dead end would cost Saarthi the
 * customer in order to punish the salesperson.
 */
export function ReferralLandingPage(): React.ReactElement {
  const { code = '' } = useParams();
  const { status } = useAuth();

  const referral = useQuery({
    queryKey: ['referral', code],
    queryFn: () => api.get<PublicReferralView>(`/referrals/public/${encodeURIComponent(code)}`),
    enabled: code.length > 0,
    retry: false,
  });

  const capture = useMutation({
    mutationFn: () =>
      api.post(`/referrals/public/${encodeURIComponent(code)}/capture`, {
        source: 'REFERRAL_LINK',
      }),
  });

  const captured = React.useRef(false);

  React.useEffect(() => {
    if (!referral.data?.valid || captured.current) return;
    captured.current = true;
    rememberReferralCode(referral.data.code);
    // Best-effort. A failed capture costs the salesperson a row in their
    // "link opened" list; it must not stop the visitor reaching signup, so the
    // error is deliberately not surfaced.
    capture.mutate();
  }, [referral.data, capture]);

  // Somebody already signed in has no use for a signup page. Their account
  // exists, so their attribution — if any — was settled when they registered.
  if (status === 'authenticated') return <Navigate to="/" replace />;

  if (referral.isLoading) return <LoadingState className="min-h-screen" />;

  const invitedBy = referral.data?.valid ? referral.data.salesmanName : null;
  const registerHref = `/register?ref=${encodeURIComponent(code)}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-5 py-12">
      <SaarthiLogo className="h-9 w-auto self-start" />

      <div className="space-y-3">
        <p className="section-label">
          {invitedBy
            ? `${invitedBy} invited you to Saarthi`
            : referral.data?.valid
              ? 'You were invited to Saarthi'
              : 'Welcome to Saarthi'}
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
          Your vehicles, drivers and running costs in one place.
        </h1>
        <p className="text-muted-foreground">
          Saarthi tracks where every vehicle is, warns you before a document expires, watches the
          engine for faults, and shows what each vehicle actually costs to run.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          {[
            'Live location for every vehicle, from the Saarthi tracker.',
            'Insurance, fitness, permit and PUC, with a warning before each expires.',
            'Fault codes and engine health read from the vehicle itself.',
            'Fuel, tolls, servicing and EMIs, per vehicle.',
          ].map((line) => (
            <p key={line} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              {line}
            </p>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link to={registerHref}>
            Create your Saarthi account
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link to="/login">I already have an account</Link>
        </Button>
      </div>

      {referral.data && !referral.data.valid ? (
        /*
         * Stated, not hidden. A visitor who was given this link deserves to
         * know the code did not work, and the salesperson deserves to hear
         * about it — but neither is a reason to block the signup.
         */
        <p className="text-xs text-muted-foreground">
          The referral code in this link was not recognised, so nobody will be credited for your
          signup. You can still create an account normally; mention the code to whoever gave you
          the link.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          You create your own account and authorise your own payment. Nobody at Saarthi will ever
          ask you for a password, an OTP or a UPI PIN.
        </p>
      )}
    </main>
  );
}

export default ReferralLandingPage;
