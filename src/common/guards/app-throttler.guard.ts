import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * Global rate-limit guard (runs before JWT).
 * Tracks by client IP (+ optional Bearer fingerprint) and returns a structured
 * 429 body the Flutter client can retry on.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const forwarded = headers['x-forwarded-for'];
    const forwardedIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : Array.isArray(forwarded)
          ? String(forwarded[0] ?? '')
              .split(',')[0]
              ?.trim()
          : '';
    const socket = req.socket as { remoteAddress?: string } | undefined;
    const ip =
      forwardedIp ||
      (typeof req.ip === 'string' ? req.ip : '') ||
      socket?.remoteAddress ||
      'unknown';

    // Soft-separate clients behind the same NAT when a bearer token is present.
    const auth = headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.length > 20) {
      return `ip:${ip}:t${auth.length}:${auth.slice(7, 19)}`;
    }
    return `ip:${ip}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterMs = Math.max(
      detail.timeToBlockExpire || 0,
      detail.timeToExpire || 0,
      detail.ttl || 1_000,
      500,
    );

    const { res } = this.getRequestResponse(context);
    try {
      this.setResponseHeader(res, 'Retry-After', Math.ceil(retryAfterMs / 1000));
      this.setResponseHeader(res, 'X-RateLimit-Limit', detail.limit);
      this.setResponseHeader(res, 'X-RateLimit-Remaining', 0);
    } catch {
      // Response may already be closed.
    }

    throw new HttpException(
      {
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
        retryAfterMs,
        limit: detail.limit,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
