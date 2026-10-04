import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** The switch's track and its buttons — shared with switches built by hand. */
export const SWITCH_LIST_CLASS =
  'h-auto flex-wrap rounded-[12px] bg-foreground/[0.04] p-[3px] ring-0 dark:bg-white/[0.05]';
export const SWITCH_TRIGGER_CLASS =
  'min-h-[38px] rounded-[9px] px-3.5 text-[13px] data-[state=active]:ring-0 data-[state=active]:shadow-[0_1px_2px_rgb(20_22_40/0.08)]';

export interface SwitchSection {
  value: string;
  label: string;
  content: React.ReactNode;
}

/**
 * The sections inside one of the vehicle page's tabs — Trips, Maintenance and
 * Driver history under History, and so on.
 *
 * Controlled, so the header's overflow menu can open a tab *at* a section. A
 * tab whose caller may see only one section shows that section without a
 * one-option switch above it.
 */
export function SectionSwitch({
  sections,
  value,
  onValueChange,
  label,
}: {
  sections: SwitchSection[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  /** Names the switch for assistive technology, e.g. "History sections". */
  label: string;
}) {
  const first = sections[0];
  if (!first) return null;
  if (sections.length === 1) return <>{first.content}</>;

  const current = sections.some((section) => section.value === value) ? value : first.value;

  return (
    <Tabs value={current} onValueChange={onValueChange} className="space-y-5">
      <TabsList aria-label={label} className={SWITCH_LIST_CLASS}>
        {sections.map((section) => (
          <TabsTrigger key={section.value} value={section.value} className={SWITCH_TRIGGER_CLASS}>
            {section.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {sections.map((section) => (
        <TabsContent key={section.value} value={section.value} className="mt-0">
          {section.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
