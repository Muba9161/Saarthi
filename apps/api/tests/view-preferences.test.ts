import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * List presentation preferences.
 *
 * Small surface, one property that matters: these are personal settings, and
 * one user's choice must never reach another's screen.
 */
describe('View preferences', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let colleague: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    colleague = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: fleet.id });
  });

  interface Preference {
    surface: string;
    viewMode: string;
    hiddenColumns: string[];
    pageSize: number | null;
  }

  it('starts with nothing saved', async () => {
    const { status, body } = await request<Preference[]>({
      method: 'GET',
      url: '/api/v1/me/view-preferences',
      user: owner,
    });

    expect(status).toBe(200);
    // A user who never touches the toggle costs no rows at all.
    expect(body.data).toEqual([]);
  });

  it('remembers a chosen layout', async () => {
    const saved = await request<Preference>({
      method: 'PUT',
      url: '/api/v1/me/view-preferences/fleet.vehicles',
      user: owner,
      payload: { viewMode: 'CARDS' },
    });

    expect(saved.status).toBe(200);
    expect(saved.body.data.viewMode).toBe('CARDS');

    const listed = await request<Preference[]>({
      method: 'GET',
      url: '/api/v1/me/view-preferences',
      user: owner,
    });
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]?.surface).toBe('fleet.vehicles');
  });

  it('updates the existing row rather than adding another', async () => {
    const url = '/api/v1/me/view-preferences/fleet.vehicles';
    await request({ method: 'PUT', url, user: owner, payload: { viewMode: 'CARDS' } });
    await request({ method: 'PUT', url, user: owner, payload: { viewMode: 'TABLE' } });

    const rows = await prisma.userViewPreference.findMany({ where: { userId: owner.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.viewMode).toBe('TABLE');
  });

  it('keeps hidden columns when only the layout changes', async () => {
    const url = '/api/v1/me/view-preferences/fleet.vehicles';
    await request({
      method: 'PUT',
      url,
      user: owner,
      payload: { viewMode: 'TABLE', hiddenColumns: ['odometer', 'driver'] },
    });

    const updated = await request<Preference>({
      method: 'PUT',
      url,
      user: owner,
      payload: { viewMode: 'CARDS' },
    });

    expect(updated.body.data.viewMode).toBe('CARDS');
    expect(updated.body.data.hiddenColumns).toEqual(['odometer', 'driver']);
  });

  it('does not let one person change another person view', async () => {
    await request({
      method: 'PUT',
      url: '/api/v1/me/view-preferences/fleet.vehicles',
      user: owner,
      payload: { viewMode: 'CARDS' },
    });

    const theirs = await request<Preference[]>({
      method: 'GET',
      url: '/api/v1/me/view-preferences',
      user: colleague,
    });

    // Same organization, same screen, entirely separate preference.
    expect(theirs.body.data).toEqual([]);
  });

  it('forgets a surface on request', async () => {
    const url = '/api/v1/me/view-preferences/fleet.vehicles';
    await request({ method: 'PUT', url, user: owner, payload: { viewMode: 'CARDS' } });
    await request({ method: 'DELETE', url, user: owner });

    const listed = await request<Preference[]>({
      method: 'GET',
      url: '/api/v1/me/view-preferences',
      user: owner,
    });
    expect(listed.body.data).toEqual([]);
  });

  it('rejects a surface key that is not a surface key', async () => {
    const response = await request({
      method: 'PUT',
      url: '/api/v1/me/view-preferences/..%2Fadmin',
      user: owner,
      payload: { viewMode: 'CARDS' },
    });
    expect([400, 404]).toContain(response.status);
  });

  it('requires a session', async () => {
    const response = await request({ method: 'GET', url: '/api/v1/me/view-preferences' });
    expect(response.status).toBe(401);
  });
});
