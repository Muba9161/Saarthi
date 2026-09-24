import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ok, parseParams } from '../../lib/http';
import { requireAuth } from '../../server/guards';
import { handleCashfreeWebhook } from './cashfree-webhook.service';
import { paymentStatusFor, settlePayment } from './payment-settlement.service';

const referenceParamSchema = z.object({
  reference: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

/**
 * A payment as the payer sees it after checkout.
 *
 * `confirm` is what the web app calls when the payer returns from a hosted
 * checkout: it asks the gateway for the real outcome and applies it, so the
 * flow completes even where a webhook cannot reach the API (a laptop). It is
 * scoped to the caller's own organization.
 */
export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/:reference', async (request, reply) => {
    const auth = requireAuth(request);
    const { reference } = parseParams(referenceParamSchema, request.params);
    return ok(reply, await paymentStatusFor(auth.organizationId, auth.isPlatformAdmin, reference));
  });

  app.post('/:reference/confirm', async (request, reply) => {
    const auth = requireAuth(request);
    const { reference } = parseParams(referenceParamSchema, request.params);
    // Ownership first: a caller must not be able to settle somebody else's payment.
    await paymentStatusFor(auth.organizationId, auth.isPlatformAdmin, reference);
    await settlePayment(reference);
    return ok(reply, await paymentStatusFor(auth.organizationId, auth.isPlatformAdmin, reference));
  });
}

/**
 * Cashfree's webhook endpoint. Public by necessity — the caller is Cashfree —
 * and trusted only through the signature, which is checked over the raw body.
 * The raw-body parser is encapsulated to this plugin.
 */
export async function cashfreeWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, typeof body === 'string' ? body : body.toString('utf8'));
  });

  app.post('/', async (request, reply) => {
    const header = (name: string): string | undefined => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const result = await handleCashfreeWebhook({
      rawBody: typeof request.body === 'string' ? request.body : '',
      timestamp: header('x-webhook-timestamp'),
      signature: header('x-webhook-signature'),
      idempotencyKey: header('x-idempotency-key'),
    });
    return ok(reply, { received: true, duplicate: result.duplicate });
  });
}
