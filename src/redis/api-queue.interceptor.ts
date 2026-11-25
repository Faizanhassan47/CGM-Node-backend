import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { ApiQueueService, QueueLane } from './api-queue.service';

const INGEST_PATH = /\/api\/Glucose\/(sync-bulk|measurement)\b/i;
const AI_PATH = /\/api\/DietAssistant\b/i;
const HEAVY_PATH =
  /\/api\/(Glucose\/(history|summary)|Reports|Admin\/users\/[^/]+\/record|wellness\/meal-glucose|Family\/weekly-report|Family\/members\/[^/]+\/report-summary)/i;

/** Exported for unit tests — every HTTP API is classified into a lane. */
export function classifyQueueLane(path: string): QueueLane {
  if (INGEST_PATH.test(path)) return 'ingest';
  if (AI_PATH.test(path)) return 'ai';
  if (HEAVY_PATH.test(path)) return 'heavy';
  return 'light';
}

@Injectable()
export class ApiQueueInterceptor implements NestInterceptor {
  constructor(private readonly queue: ApiQueueService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method?: string;
      path?: string;
      originalUrl?: string;
      url?: string;
      abortSignal?: AbortSignal;
    }>();
    const response = http.getResponse<{
      setHeader?: (name: string, value: string | number) => void;
      headersSent?: boolean;
    }>();
    const path = request.path ?? request.originalUrl?.split('?')[0] ?? request.url?.split('?')[0] ?? '';

    // Keep load-balancer probes outside the in-process request queue.
    if (
      request.method === 'GET' &&
      (path === '/' ||
        path === '/health' ||
        path.startsWith('/health/') ||
        path === '/metrics')
    ) {
      return next.handle();
    }

    const lane = classifyQueueLane(path);
    const enqueuedAt = Date.now();
    return from(
      this.queue.runHttp(lane, (signal) => {
        request.abortSignal = signal;
        this.applyQueueHeaders(response, lane, enqueuedAt);
        return lastValueFrom(next.handle());
      }),
    );
  }

  private applyQueueHeaders(
    response: { setHeader?: (name: string, value: string | number) => void; headersSent?: boolean },
    lane: QueueLane,
    enqueuedAt: number,
  ): void {
    if (!response?.setHeader || response.headersSent) return;
    const info = this.queue.laneInfo(lane);
    const waitMs = Math.max(0, Date.now() - enqueuedAt);
    try {
      response.setHeader('X-Queue-Lane', lane);
      response.setHeader('X-Queue-Active', info.active);
      response.setHeader('X-Queue-Waiting', info.waiting);
      response.setHeader('X-Queue-Limit', info.limit);
      response.setHeader('X-Queue-Wait-Ms', waitMs);
    } catch {
      // Response may already be closed; ignore header write failures.
    }
  }
}
