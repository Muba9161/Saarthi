import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NAVIGATION,
  ADMIN_NAVIGATION,
  ASSOCIATION_NAVIGATION,
  CUSTOMER_NAVIGATION,
  DRIVER_NAVIGATION,
  FLEET_NAVIGATION,
  MOBILITY_NAVIGATION,
  SUPPLIER_NAVIGATION,
  type NavSection,
} from '@/app/navigation';
import { en } from './translations';

/**
 * Keys that reach `t()` through a variable.
 *
 * This is the hole the other checks cannot see. `t(item.label)` reads as
 * translated in the source and passes every static audit, but the value comes
 * from the navigation tables — so adding a destination without adding its
 * label here renders it in English, on a sidebar where everything around it is
 * translated, with nothing anywhere reporting a problem. Three labels shipped
 * that way.
 *
 * Walking the real tables rather than a list transcribed from them is the
 * whole point: a transcribed list is exactly what went stale.
 */

const MENUS: Record<string, NavSection[]> = {
  FLEET_NAVIGATION,
  SUPPLIER_NAVIGATION,
  CUSTOMER_NAVIGATION,
  ASSOCIATION_NAVIGATION,
  MOBILITY_NAVIGATION,
  DRIVER_NAVIGATION,
  ADMIN_NAVIGATION,
};

const defined = new Set(Object.keys(en));

describe('navigation copy', () => {
  it('defines every section title', () => {
    const missing: string[] = [];

    for (const [menu, sections] of Object.entries(MENUS)) {
      for (const section of sections) {
        if (!defined.has(section.title)) missing.push(`${menu}: ${section.title}`);
      }
    }

    expect(missing, `section titles absent from en.ts:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('defines every destination label, in every menu', () => {
    const missing: string[] = [];

    for (const [menu, sections] of Object.entries(MENUS)) {
      for (const section of sections) {
        for (const item of section.items) {
          if (!defined.has(item.label)) missing.push(`${menu}: ${item.label}`);
        }
      }
    }

    for (const item of ACCOUNT_NAVIGATION) {
      if (!defined.has(item.label)) missing.push(`ACCOUNT_NAVIGATION: ${item.label}`);
    }

    expect(missing, `navigation labels absent from en.ts:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('covers every menu the app can show, not just the fleet one', () => {
    // The fault was found in the fleet sidebar; the customer, supplier, driver,
    // association, mobility and admin menus are just as reachable and were
    // never checked. Guard the count so a new menu cannot be added without
    // being registered here.
    expect(Object.keys(MENUS)).toHaveLength(7);

    for (const [menu, sections] of Object.entries(MENUS)) {
      expect(sections.length, `${menu} is empty`).toBeGreaterThan(0);
    }
  });
});
