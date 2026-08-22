import type { FastifyInstance } from 'fastify';
import {
  Permission,
  patchProfileSectionSchema,
  profileDirectoryQuerySchema,
  profileSectionParamSchema,
  setProfileSlugSchema,
  updateOrganizationProfileSchema,
  updateUserProfileSchema,
} from '@saarthi/shared';
import { ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as profileService from './profile.service';
import * as directoryService from './directory.service';

/**
 * Profile routes.
 *
 * The builder is not entitlement-gated and needs no permission beyond a valid
 * session: every account type on every plan can complete its own profile. The
 * directory is the only part that needs a grant, because it lists other people.
 */
export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /** Blueprint, current values and completion in one round trip. */
  app.get('/builder', async (request, reply) => {
    const auth = requireAuth(request);
    return ok(reply, await profileService.getBuilder(auth));
  });

  app.get('/completion', async (request, reply) => {
    const auth = requireAuth(request);
    return ok(reply, await profileService.getCompletion(auth));
  });

  app.patch('/builder/:sectionKey', async (request, reply) => {
    const auth = requireAuth(request);
    const { sectionKey } = parseParams(profileSectionParamSchema, request.params);
    const { values } = parseBody(patchProfileSectionSchema, request.body);

    const result = await profileService.patchSection(auth, sectionKey, values);

    await auditFromRequest(request, {
      action: AuditAction.PROFILE_SECTION_UPDATED,
      entityType: 'UserProfile',
      entityId: auth.user.id,
      // Field *names*, never their values: a profile patch carries personal
      // data and the audit log is read far more widely than the profile is.
      after: { section: result.section, fields: result.updatedFields },
    });

    return ok(reply, result);
  });

  app.patch('/me', async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(updateUserProfileSchema, request.body);
    await profileService.updateUserProfile(auth, input);

    await auditFromRequest(request, {
      action: AuditAction.PROFILE_SECTION_UPDATED,
      entityType: 'UserProfile',
      entityId: auth.user.id,
      after: { fields: Object.keys(input) },
    });

    return ok(reply, await profileService.getBuilder(auth));
  });

  app.get(
    '/organization',
    { preHandler: requirePermission(Permission.ORG_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await directoryService.getOrganizationProfile(organizationId));
    },
  );

  app.patch(
    '/organization',
    { preHandler: requirePermission(Permission.ORG_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(updateOrganizationProfileSchema, request.body);
      await profileService.updateOrganizationProfile(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.PROFILE_SECTION_UPDATED,
        entityType: 'OrganizationProfile',
        entityId: organizationId,
        organizationId,
        after: { fields: Object.keys(input) },
      });

      return ok(reply, await directoryService.getOrganizationProfile(organizationId));
    },
  );

  app.post('/slug', async (request, reply) => {
    const auth = requireAuth(request);
    const { slug, target } = parseBody(setProfileSlugSchema, request.body);
    const result = await profileService.setSlug(auth, target, slug);

    await auditFromRequest(request, {
      action: AuditAction.PROFILE_SLUG_SET,
      entityType: target === 'organization' ? 'OrganizationProfile' : 'UserProfile',
      entityId: target === 'organization' ? (auth.organizationId ?? '') : auth.user.id,
      after: { slug },
    });

    return ok(reply, result);
  });

  // ---------------------------------------------------------------------
  // Internal directory. Requires a session and a grant — there is no public
  // profile surface anywhere in Saarthi.
  // ---------------------------------------------------------------------
  app.get(
    '/directory',
    { preHandler: requirePermission(Permission.PROFILE_DIRECTORY) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(profileDirectoryQuerySchema, request.query);
      const result = await directoryService.searchDirectory(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/:slug',
    { preHandler: requirePermission(Permission.PROFILE_DIRECTORY) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { slug } = request.params as { slug: string };
      return ok(reply, await directoryService.getBySlug(auth, slug));
    },
  );
}
