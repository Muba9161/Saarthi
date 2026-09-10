import * as React from 'react';
import { Camera, ImageOff } from 'lucide-react';
import { MediaOwnerType, MediaPurpose, Permission } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { PhotoUploader } from '@/features/media/photo-uploader';
import { SectionHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

/**
 * A vehicle's photographs — its own section, not part of its paperwork.
 *
 * These used to be uploaded as a `TRUCK_PHOTO` document, which was wrong in
 * three ways at once. A photograph has no number and no expiry, so the document
 * row it produced was mostly empty columns. It inherited the verification
 * pipeline, so a picture of a lorry sat marked "pending verification" waiting
 * for a reviewer who has nothing to decide. And a document is presented as a
 * file name with a download button, so the one thing a photograph is for —
 * being looked at — took two clicks and a new browser tab.
 *
 * So they live in the media library instead, under the vehicle itself. Nothing
 * here is reviewed or verified: an upload is finished the moment it lands, and
 * the picture is the record of it.
 *
 * Split by purpose rather than pooled into one album because the three are
 * asked for at different times and by different people — exterior shots
 * identify the vehicle, interior shots matter to a passenger operator and a
 * buyer, and damage shots are evidence attached to a specific event. Pooling
 * them would mean scrolling past forty exterior shots to find the dent.
 */
export function VehiclePhotosPanel({
  vehicleId,
  registrationNumber,
}: {
  vehicleId: string;
  registrationNumber?: string | null;
}) {
  const { can } = useAuth();

  // Read is what decides whether the section is worth rendering at all; upload
  // and delete only decide whether it is editable.
  const canRead = can(Permission.MEDIA_READ);
  const readOnly = !can(Permission.MEDIA_UPLOAD);

  if (!canRead) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={ImageOff}
            title="Photos are not available to your role"
            description="Ask an owner or fleet manager for access to this vehicle's media."
            className="min-h-40 border-0"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Photos"
          description={
            registrationNumber
              ? `Pictures of ${registrationNumber}. Never sent for verification - an upload is done the moment it lands.`
              : 'Pictures of this vehicle. Never sent for verification - an upload is done the moment it lands.'
          }
        />
      </CardHeader>

      <CardContent className="space-y-5 pt-0">
        <PhotoUploader
          ownerType={MediaOwnerType.VEHICLE}
          ownerId={vehicleId}
          purpose={MediaPurpose.VEHICLE_EXTERIOR}
          label="Exterior"
          description="Front, rear and both sides. The first one is what identifies the vehicle on cards and headers."
          max={12}
          disabled={readOnly}
        />

        <Separator />

        <PhotoUploader
          ownerType={MediaOwnerType.VEHICLE}
          ownerId={vehicleId}
          purpose={MediaPurpose.VEHICLE_INTERIOR}
          label="Interior"
          description="Cabin, seats and dashboard."
          max={8}
          disabled={readOnly}
        />

        <Separator />

        <PhotoUploader
          ownerType={MediaOwnerType.VEHICLE}
          ownerId={vehicleId}
          purpose={MediaPurpose.VEHICLE_DAMAGE}
          label="Damage"
          description="Dents, scrapes and anything a workshop or an insurer will need to see."
          max={12}
          disabled={readOnly}
        />

        {readOnly ? (
          <p className="text-xs text-muted-foreground">
            <Camera className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
            Your role can view these photos but not add or remove them.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default VehiclePhotosPanel;
