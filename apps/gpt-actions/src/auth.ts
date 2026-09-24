// Auth-Middleware für den REST-Adapter (#98, AC-2/AC-3/AC-11).
// Bearer-Token gegen GPT_ACTIONS_API_KEY, plus Basisschutz gegen Brute-Force.
import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Konstante Laufzeit unabhängig von der Position der ersten Abweichung, um
// Timing-Angriffe auf den Key zu erschweren.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function requireApiKey(apiKey: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = match?.[1]?.trim();
    if (!token || !timingSafeEqual(token, apiKey)) {
      res.status(401).json({ error: 'Ungültiger oder fehlender API-Key. Header „Authorization: Bearer <key>" erforderlich.' });
      return;
    }
    next();
  };
}

// Basisschutz gegen Brute-Force auf den API-Key (AC-11): max. `limit`
// fehlgeschlagene Versuche pro IP innerhalb von `windowMs`, danach 429.
// Erfolgreiche (auth-bestätigte) Requests zählen nicht mit. Als Fabrik
// exportiert, damit Tests (scripts/gpt-actions.test.ts) ein kleines Limit
// verwenden können, ohne 20 echte Requests zu brauchen.
export function createAuthFailureLimiter(limit = 20, windowMs = 15 * 60 * 1000): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Zu viele fehlgeschlagene Anfragen. Bitte später erneut versuchen.' },
  });
}

export const authFailureLimiter: RequestHandler = createAuthFailureLimiter(20, 15 * 60 * 1000);
