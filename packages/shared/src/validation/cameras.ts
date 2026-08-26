import { z } from 'zod';
import { optionalTrimmedString } from './common';

/**
 * Camera registration and live viewing.
 *
 * The channel is a physical input on the recorder, so it is bounded and
 * required: "camera 2" means the lens wired into socket 2, and registering one
 * without saying which socket would make the record useless the first time
 * somebody had to service it.
 */

export const cameraPositionSchema = z.enum([
  'FRONT',
  'CABIN',
  'LEFT',
  'RIGHT',
  'REAR',
  'CARGO',
  'OTHER',
]);
export type CameraPosition = z.infer<typeof cameraPositionSchema>;

export const registerCameraSchema = z.object({
  channel: z.coerce.number().int().min(1).max(16),
  position: cameraPositionSchema.default('OTHER'),
  label: optionalTrimmedString(80),
  continuousRecording: z.coerce.boolean().default(true),
  resolution: optionalTrimmedString(20),
  frameRate: z.coerce.number().int().min(1).max(120).optional(),
});
export type RegisterCameraInput = z.infer<typeof registerCameraSchema>;

export const setCameraEnabledSchema = z.object({
  enabled: z.coerce.boolean(),
});
export type SetCameraEnabledInput = z.infer<typeof setCameraEnabledSchema>;

export const cameraClipQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CameraClipQuery = z.infer<typeof cameraClipQuerySchema>;
