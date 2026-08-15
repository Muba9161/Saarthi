import type { AuthContext } from '../auth/context';

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only after `authenticate` has run for the route. */
    auth?: AuthContext;
    /** Best-effort client IP, honouring the trust-proxy configuration. */
    clientIp: string;
  }
}

export {};
