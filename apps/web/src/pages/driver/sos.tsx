import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { LifeBuoy, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { SosType, humanizeEnum } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const TYPES = [SosType.BREAKDOWN, SosType.TYRE, SosType.FUEL, SosType.MEDICAL, SosType.ACCIDENT, SosType.SECURITY, SosType.OTHER];

/** One-tap SOS. Large targets, minimal steps, no scrolling to reach the button. */
export function DriverSosPage() {
  const navigate = useNavigate();
  const [type, setType] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState('');
  const [position, setPosition] = React.useState<{ latitude: number; longitude: number } | null>(null);

  React.useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (result) => setPosition({ latitude: result.coords.latitude, longitude: result.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  const trigger = useMutation({
    mutationFn: () => {
      if (!position) throw new Error('Waiting for your location. Enable location access and try again.');
      return api.post<{ id: string }>('/sos', { type, latitude: position.latitude, longitude: position.longitude, ...(description ? { description } : {}) });
    },
    onSuccess: (incident) => {
      toast.success('Help is being called', { description: 'Nearby Saarthi drivers are being alerted.' });
      navigate(`/driver/sos/${incident.id}`);
    },
    onError: (error) => toast.error('Could not raise the SOS', { description: errorMessage(error) }),
  });

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageHeader title="Emergency help" description="Tell us what happened. Nearby Saarthi drivers will be alerted." />

      <Alert variant="destructive">
        <Phone className="size-4" />
        <AlertTitle>For a life-threatening emergency, call 112 first</AlertTitle>
        <AlertDescription>Saarthi alerts nearby drivers who may be able to help. It does not replace emergency services.</AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 gap-3">
        {TYPES.map((entry) => (
          <Button key={entry} size="xl" variant={type === entry ? 'destructive' : 'outline'} className="h-20 flex-col gap-1" onClick={() => setType(entry)}>
            <LifeBuoy className="size-5" />
            <span className="text-sm">{humanizeEnum(entry)}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Anything that helps the person coming to you (optional)." />
          <p className="text-xs text-muted-foreground">
            {position ? `Location ready: ${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}` : 'Getting your location…'}
          </p>
          <Button size="xl" variant="destructive" className="w-full" disabled={!type || !position} loading={trigger.isPending} onClick={() => trigger.mutate()}>
            <LifeBuoy className="size-5" />Send SOS now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default DriverSosPage;
