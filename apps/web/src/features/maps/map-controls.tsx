import * as React from 'react';
import { Building2, Mountain, Settings2, Signpost, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  LIGHT_PRESETS,
  MAP_STYLE_OPTIONS,
  type LightPreset,
  type MapStyleDefinition,
  type MapStyleId,
} from './map-config';

/**
 * Map appearance controls.
 *
 * Kept out of `FleetMap` so the map component stays about map behaviour, and so
 * a page that wants these controls somewhere other than floating over the canvas
 * can place them itself.
 */

export type LightPresetSetting = LightPreset | 'auto';

export interface MapSettings {
  styleId: MapStyleId;
  /** `auto` follows the wall clock and picks a matching basemap. */
  lightPreset: LightPresetSetting;
  terrain: boolean;
  buildings: boolean;
  /** Point-of-interest pins — noise on a map already dense with vehicles. */
  labels: boolean;
}

export interface MapSettingsControlProps {
  settings: MapSettings;
  onChange: (patch: Partial<MapSettings>) => void;
  /** The active style, so the panel can reflect what it is actually showing. */
  activeStyle: MapStyleDefinition;
  className?: string;
}

interface ToggleRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
}: ToggleRowProps) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-tight">{label}</p>
        <p className="text-2xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

export function MapSettingsControl({
  settings,
  onChange,
  activeStyle,
  className,
}: MapSettingsControlProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="glass"
          className={cn('shadow-lifted', className)}
          title="Map settings"
        >
          <Settings2 className="size-4" />
          Map
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 space-y-3.5 p-3.5">
        <div className="space-y-1.5">
          <p className="section-label">Basemap</p>
          <div className="grid grid-cols-3 gap-1.5">
            {MAP_STYLE_OPTIONS.map((style) => (
              <Button
                key={style.id}
                size="sm"
                variant={style.id === settings.styleId ? 'default' : 'outline'}
                onClick={() => onChange({ styleId: style.id })}
                className="px-1 text-2xs"
                title={style.name}
              >
                {style.shortName}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Sun className="size-3.5 text-muted-foreground" />
            <p className="section-label">Lighting</p>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            <Button
              size="sm"
              variant={settings.lightPreset === 'auto' ? 'default' : 'outline'}
              onClick={() => onChange({ lightPreset: 'auto' })}
              className="px-1 text-2xs"
              title="Follow the current time of day"
            >
              Auto
            </Button>
            {LIGHT_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                size="sm"
                variant={settings.lightPreset === preset.id ? 'default' : 'outline'}
                onClick={() => onChange({ lightPreset: preset.id })}
                className="px-1 text-2xs"
              >
                {preset.name}
              </Button>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">
            Sets the sky and the sun that shades the buildings.
            {activeStyle.nightFriendly
              ? ''
              : ' Pick Dark or Fiord for a low-light basemap to match.'}
          </p>
        </div>

        <Separator />

        <div className="space-y-3">
          <ToggleRow
            icon={Mountain}
            label="3D terrain"
            description="Real elevation from open terrain tiles."
            checked={settings.terrain}
            onCheckedChange={(checked) => onChange({ terrain: checked })}
          />
          <ToggleRow
            icon={Building2}
            label="3D buildings"
            description="Extruded building footprints from OpenStreetMap."
            checked={settings.buildings}
            onCheckedChange={(checked) => onChange({ buildings: checked })}
          />
          <ToggleRow
            icon={Signpost}
            label="Place labels"
            description="Points of interest layered over the map."
            checked={settings.labels}
            onCheckedChange={(checked) => onChange({ labels: checked })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
