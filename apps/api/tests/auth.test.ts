import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MediaOwnerType,
  MediaPurpose,
  OrganizationType,
  RoleName,
  type SessionPayload,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  TEST_PASSWORD,
  closeApp,
  createOrganization,
  createUser,
  getApp,
  multipart,
  request,
  resetDatabase,
  sampleJpeg,
  unique,
  uniquePhone,
} from './helpers';

describe('Authentication', () => {
  beforeAll(async () => {
    await resetDatabase();
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('registration', () => {
    it('registers a fleet owner, creates their organization and returns a session', async () => {
      const email = `${unique('owner')}@test.local`;
      const { status, body } = await request<{ accessToken: string; session: SessionPayload }>({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Rajesh',
          lastName: 'Sharma',
          email,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.FLEET_OWNER,
          organizationName: 'Sharma Haulage',
          acceptedTerms: true,
        },
      });

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toBeTruthy();
      expect(body.data.session.user.email).toBe(email.toLowerCase());
      expect(body.data.session.organization?.name).toBe('Sharma Haulage');
      expect(body.data.session.organization?.type).toBe(OrganizationType.FLEET_OWNER);
      expect(body.data.session.permissions).toContain('fleet.trucks.create');

      // A new fleet must be usable immediately: it needs a subscription.
      expect(body.data.session.subscription).not.toBeNull();
    });

    it('registers a customer with no company and names the organization after them', async () => {
      const email = `${unique('individual')}@test.local`;
      const { status, body } = await request<{ session: SessionPayload }>({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Anita',
          lastName: 'Verma',
          email,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.CUSTOMER,
          // No organizationName: somebody booking a cab or ordering a load of
          // sand for their own house has no company to name.
          acceptedTerms: true,
        },
      });

      expect(status).toBe(201);
      // The organization still exists — orders and bookings hang off one — and
      // carries the person's own name.
      expect(body.data.session.organization?.name).toBe('Anita Verma');
      expect(body.data.session.organization?.type).toBe(OrganizationType.CUSTOMER);
      expect(body.data.session.subscription).not.toBeNull();
    });

    it('still requires a business name from a fleet owner', async () => {
      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Rajesh',
          lastName: 'Sharma',
          email: `${unique('nofleetname')}@test.local`,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.FLEET_OWNER,
          acceptedTerms: true,
        },
      });

      expect(status).toBe(400);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('accepts a profile photo on the session registration just returned', async () => {
      // The sign-up form holds the photo locally and uploads it the moment the
      // account exists, because media is addressed to an owner id nobody has
      // before then. This is that second call.
      const registered = await request<{ accessToken: string; session: SessionPayload }>({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Priya',
          lastName: 'Nair',
          email: `${unique('withphoto')}@test.local`,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.CUSTOMER,
          acceptedTerms: true,
        },
      });
      expect(registered.status).toBe(201);

      const headers = { authorization: `Bearer ${registered.body.data.accessToken}` };
      const body = multipart(
        {
          ownerType: MediaOwnerType.USER,
          ownerId: registered.body.data.session.user.id,
          purpose: MediaPurpose.AVATAR,
        },
        {
          fieldName: 'file',
          fileName: 'me.jpg',
          contentType: 'image/jpeg',
          content: sampleJpeg(2_048),
        },
      );

      const upload = await request({
        method: 'POST',
        url: '/api/v1/media',
        payload: body.payload,
        headers: { ...headers, ...body.headers },
      });
      expect(upload.status).toBe(201);

      // Mirrored onto the user, which is what the app shell reads.
      const session = await request<SessionPayload>({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers,
      });
      expect(session.body.data.user.avatarUrl).toBeTruthy();
    });

    it('accepts a company logo onto the organization registration just created', async () => {
      // The business account types are asked for a logo rather than a face:
      // it is the organization that appears on listings, orders and invoices.
      const registered = await request<{ accessToken: string; session: SessionPayload }>({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Vikram',
          lastName: 'Singh',
          email: `${unique('withlogo')}@test.local`,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.FLEET_OWNER,
          organizationName: 'Singh Roadlines',
          acceptedTerms: true,
        },
      });
      expect(registered.status).toBe(201);

      const organizationId = registered.body.data.session.organization?.id;
      expect(organizationId).toBeTruthy();

      const body = multipart(
        {
          ownerType: MediaOwnerType.ORGANIZATION,
          ownerId: organizationId!,
          purpose: MediaPurpose.LOGO,
        },
        {
          fieldName: 'file',
          fileName: 'logo.jpg',
          contentType: 'image/jpeg',
          content: sampleJpeg(2_048),
        },
      );

      const upload = await request({
        method: 'POST',
        url: '/api/v1/media',
        payload: body.payload,
        headers: {
          authorization: `Bearer ${registered.body.data.accessToken}`,
          ...body.headers,
        },
      });
      expect(upload.status).toBe(201);

      // Mirrored onto the organization, which is what listings and invoices read.
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId! },
        select: { logoUrl: true },
      });
      expect(organization?.logoUrl).toBeTruthy();
    });

    it('never returns the password hash', async () => {
      const email = `${unique('nohash')}@test.local`;
      const { body } = await request<Record<string, unknown>>({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Test',
          lastName: 'User',
          email,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.CUSTOMER,
          organizationName: 'Test Buyer',
          acceptedTerms: true,
        },
      });

      expect(JSON.stringify(body)).not.toContain('passwordHash');
      expect(JSON.stringify(body)).not.toContain(TEST_PASSWORD);
    });

    it('rejects a weak password with a field-level message', async () => {
      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Test',
          lastName: 'User',
          email: `${unique('weak')}@test.local`,
          phone: uniquePhone(),
          password: 'short',
          role: RoleName.CUSTOMER,
          organizationName: 'Test Buyer',
          acceptedTerms: true,
        },
      });

      expect(status).toBe(400);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a duplicate email address', async () => {
      const email = `${unique('dupe')}@test.local`;
      const payload = {
        firstName: 'Test',
        lastName: 'User',
        email,
        phone: uniquePhone(),
        password: TEST_PASSWORD,
        role: RoleName.CUSTOMER,
        organizationName: 'Test Buyer',
        acceptedTerms: true,
      };

      await request({ method: 'POST', url: '/api/v1/auth/register', payload });
      const second = await request({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { ...payload, phone: uniquePhone() },
      });

      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe('DUPLICATE_RESOURCE');
    });

    it('requires an organization name for a fleet owner', async () => {
      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Test',
          lastName: 'User',
          email: `${unique('noorg')}@test.local`,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.FLEET_OWNER,
          acceptedTerms: true,
        },
      });

      expect(status).toBe(400);
      expect(body.error?.message).toMatch(/organization name/i);
    });

    it('registers a driver into an existing fleet using its invite code', async () => {
      const fleet = await createOrganization(OrganizationType.FLEET_OWNER);

      const { status, body } = await request<{ session: SessionPayload }>({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Ramesh',
          lastName: 'Kumar',
          email: `${unique('driver')}@test.local`,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.DRIVER,
          fleetInviteCode: fleet.inviteCode,
          licenseNumber: unique('DL-'),
          acceptedTerms: true,
        },
      });

      expect(status).toBe(201);
      expect(body.data.session.organization?.id).toBe(fleet.id);
      expect(body.data.session.driver).not.toBeNull();
      expect(body.data.session.permissions).toContain('sos.trigger');
      // A driver must never be able to manage the fleet's trucks.
      expect(body.data.session.permissions).not.toContain('fleet.trucks.create');
    });

    it('rejects a driver registration with an unknown invite code', async () => {
      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Ramesh',
          lastName: 'Kumar',
          email: `${unique('driver')}@test.local`,
          phone: uniquePhone(),
          password: TEST_PASSWORD,
          role: RoleName.DRIVER,
          fleetInviteCode: 'SR-NOPE00',
          licenseNumber: unique('DL-'),
          acceptedTerms: true,
        },
      });

      expect(status).toBe(400);
      expect(body.error?.message).toMatch(/invite code/i);
    });
  });

  describe('login', () => {
    it('signs in with valid credentials and sets an httpOnly refresh cookie', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });

      const app = await getApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: TEST_PASSWORD },
      });

      expect(response.statusCode).toBe(200);
      const cookie = response.cookies.find((entry) => entry.name === 'saarthi_refresh');
      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    });

    it('rejects a wrong password without revealing whether the account exists', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });

      const wrongPassword = await request({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: 'WrongPassword123!' },
      });
      const unknownEmail = await request({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@test.local', password: 'WrongPassword123!' },
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.error?.code).toBe(unknownEmail.body.error?.code);
      expect(wrongPassword.body.error?.message).toBe(unknownEmail.body.error?.message);
    });

    it('records a failed sign-in attempt in the audit log', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'ghost@test.local', password: 'WrongPassword123!' },
      });

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'user.login_failed' },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry).not.toBeNull();
    });

    it('blocks a suspended account', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: TEST_PASSWORD },
      });

      expect(status).toBe(403);
      expect(body.error?.message).toMatch(/not active/i);
    });
  });

  describe('protected access', () => {
    it('rejects a request with no token', async () => {
      const { status, body } = await request({ method: 'GET', url: '/api/v1/auth/me' });
      expect(status).toBe(401);
      expect(body.error?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a malformed token', async () => {
      const { status, body } = await request({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      expect(status).toBe(401);
      expect(body.error?.code).toBe('TOKEN_INVALID');
    });

    it('returns the full session for a valid token', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });

      const { status, body } = await request<SessionPayload>({
        method: 'GET',
        url: '/api/v1/auth/me',
        user,
      });

      expect(status).toBe(200);
      expect(body.data.user.id).toBe(user.id);
      expect(body.data.organization?.id).toBe(organization.id);
      expect(body.data.subscription?.features).toContain('fleet.basic');
    });
  });

  describe('refresh and logout', () => {
    it('exchanges the refresh cookie for a new access token and rotates it', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });
      const app = await getApp();

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: TEST_PASSWORD },
      });
      const firstCookie = login.cookies.find((entry) => entry.name === 'saarthi_refresh')!;

      const refreshed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        cookies: { saarthi_refresh: firstCookie.value },
        payload: {},
      });

      expect(refreshed.statusCode).toBe(200);
      const secondCookie = refreshed.cookies.find((entry) => entry.name === 'saarthi_refresh')!;
      expect(secondCookie.value).not.toBe(firstCookie.value);

      // The rotated-out token must no longer work.
      const replay = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        cookies: { saarthi_refresh: firstCookie.value },
        payload: {},
      });
      expect(replay.statusCode).toBe(401);
    });

    it('revokes the session on logout so the access token stops working', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });

      const before = await request({ method: 'GET', url: '/api/v1/auth/me', user });
      expect(before.status).toBe(200);

      const loggedOut = await request({ method: 'POST', url: '/api/v1/auth/logout', user });
      expect(loggedOut.status).toBe(200);

      const after = await request({ method: 'GET', url: '/api/v1/auth/me', user });
      expect(after.status).toBe(401);
    });
  });

  describe('password management', () => {
    it('changes a password and invalidates other sessions', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });

      // A second device for the same account.
      const app = await getApp();
      const otherLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: TEST_PASSWORD },
      });
      const otherToken = (otherLogin.json() as { data: { accessToken: string } }).data.accessToken;

      const changed = await request({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        user,
        payload: { currentPassword: TEST_PASSWORD, newPassword: 'BrandNewPass456!' },
      });
      expect(changed.status).toBe(200);

      const otherDevice = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${otherToken}` },
      });
      expect(otherDevice.statusCode).toBe(401);

      const withNewPassword = await request({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: 'BrandNewPass456!' },
      });
      expect(withNewPassword.status).toBe(200);
    });

    it('rejects a password change with the wrong current password', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });

      const { status } = await request({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        user,
        payload: { currentPassword: 'NotMyPassword1!', newPassword: 'BrandNewPass456!' },
      });
      expect(status).toBe(400);
    });

    it('completes a password reset via a single-use token', async () => {
      const organization = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });

      const requested = await request<{ devToken?: string }>({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: user.email },
      });
      expect(requested.status).toBe(200);
      const token = requested.body.data.devToken;
      expect(token).toBeTruthy();

      const reset = await request({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token, password: 'ResetPass789!' },
      });
      expect(reset.status).toBe(200);

      const signIn = await request({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: 'ResetPass789!' },
      });
      expect(signIn.status).toBe(200);

      // The same token must not be reusable.
      const replay = await request({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: { token, password: 'AnotherPass000!' },
      });
      expect(replay.status).toBe(400);
    });

    it('does not reveal whether an email address has an account', async () => {
      const known = await createOrganization();
      const user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: known.id });

      const existing = await request<{ message: string }>({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: user.email },
      });
      const missing = await request<{ message: string }>({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'definitely-not-registered@test.local' },
      });

      expect(existing.status).toBe(missing.status);
      expect(existing.body.data.message).toBe(missing.body.data.message);
    });
  });
});
