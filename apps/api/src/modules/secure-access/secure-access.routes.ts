import type { FastifyInstance } from 'fastify';
import {
  idParamSchema,
  registerPasskeySchema,
  setSecurePinSchema,
  unlockWithPasskeySchema,
  unlockWithPinSchema,
} from '@saarthi/shared';
import { noContent, ok, parseBody, parseParams } from '../../lib/http';
import { requireAuth } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as passkeyService from './passkey.service';
import * as secureAccessService from './secure-access.service';

/**
 * Secure access, mounted at `/security`: the person's own PIN and passkeys, and
 * unlocking sensitive details on this session. Everything here is about the
 * signed-in person, so no permission beyond being signed in is asked for.
 *
 * Unlock attempts are rate-limited on top of the PIN's own lockout, so a
 * scripted guesser meets two walls rather than one.
 */
export async function secureAccessRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  const unlockRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.get('/access', async (request, reply) =>
    ok(reply, await secureAccessService.secureAccessStatus(requireAuth(request))),
  );

  app.put('/pin', { config: unlockRateLimit }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(setSecurePinSchema, request.body);
    await secureAccessService.setSecurePin(auth, input);
    await auditFromRequest(request, {
      action: AuditAction.SECURE_PIN_SET,
      entityType: 'User',
      entityId: auth.user.id,
    });
    return ok(reply, await secureAccessService.secureAccessStatus(auth));
  });

  app.post('/unlock/pin', { config: unlockRateLimit }, async (request, reply) => {
    const auth = requireAuth(request);
    const { pin } = parseBody(unlockWithPinSchema, request.body);
    const unlockedUntil = await secureAccessService.unlockWithPin(auth, pin);
    return ok(reply, { unlockedUntil: unlockedUntil.toISOString() });
  });

  app.post('/unlock/passkey/options', { config: unlockRateLimit }, async (request, reply) =>
    ok(
      reply,
      await passkeyService.passkeyUnlockOptions(
        requireAuth(request),
        passkeyService.relyingParty(request),
      ),
    ),
  );

  app.post('/unlock/passkey', { config: unlockRateLimit }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(unlockWithPasskeySchema, request.body);
    const unlockedUntil = await passkeyService.unlockWithPasskey(
      auth,
      passkeyService.relyingParty(request),
      input,
    );
    return ok(reply, { unlockedUntil: unlockedUntil.toISOString() });
  });

  app.post('/lock', async (request, reply) => {
    await secureAccessService.lock(requireAuth(request));
    return noContent(reply);
  });

  app.post('/passkeys/options', async (request, reply) =>
    ok(
      reply,
      await passkeyService.passkeyRegistrationOptions(
        requireAuth(request),
        passkeyService.relyingParty(request),
      ),
    ),
  );

  app.post('/passkeys', async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(registerPasskeySchema, request.body);
    await passkeyService.registerPasskey(auth, passkeyService.relyingParty(request), input);
    await auditFromRequest(request, {
      action: AuditAction.PASSKEY_ADDED,
      entityType: 'User',
      entityId: auth.user.id,
    });
    return ok(reply, await secureAccessService.secureAccessStatus(auth));
  });

  app.delete('/passkeys/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    await passkeyService.removePasskey(auth, id);
    await auditFromRequest(request, {
      action: AuditAction.PASSKEY_REMOVED,
      entityType: 'User',
      entityId: auth.user.id,
      after: { passkeyId: id },
    });
    return noContent(reply);
  });
}
