import type { Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { unauthorized } from "./lib/errors";

export interface Authenticator { authenticate(token: string | undefined): Promise<string> }

export function supabaseAuthenticator(db: SupabaseClient): Authenticator {
  return {
    async authenticate(token) {
      if (!token) throw unauthorized();
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) throw unauthorized("Your session has ended. Please sign in again.");
      return data.user.id;
    },
  };
}

/** Development shortcut. Config refuses this mode when NODE_ENV=production. */
export function localAuthenticator(userId: string): Authenticator {
  return { authenticate: async () => userId };
}

declare module "express-serve-static-core" {
  interface Request { userId?: string; requestId?: string }
}

export function requireAuth(auth: Authenticator) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const m = /^Bearer (.+)$/i.exec(req.header("authorization") ?? "");
    req.userId = await auth.authenticate(m?.[1]);
    next();
  };
}

/**
 * Remembers a token that Supabase just confirmed, for a short time, so a busy page does not call Supabase on every request.
 * Only successes are cached. The trade off: a token revoked or a user signed out stays accepted here for up to `ttlMs`.
 */
export function cachedAuthenticator(inner: Authenticator, o: { ttlMs: number; max?: number; now?: () => number }): Authenticator {
  if (o.ttlMs <= 0) return inner;
  const now = o.now ?? Date.now, max = o.max ?? 2000, seen = new Map<string, { uid: string; at: number }>();
  return {
    async authenticate(token) {
      if (!token) return inner.authenticate(token);
      const k = createHash("sha256").update(token).digest("hex"), hit = seen.get(k);
      if (hit && now() - hit.at < o.ttlMs) return hit.uid;
      const uid = await inner.authenticate(token);
      seen.set(k, { uid, at: now() });
      while (seen.size > max) seen.delete(seen.keys().next().value as string);
      return uid;
    },
  };
}
