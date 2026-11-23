import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { ApiQueueService, QueueLane } from './api-queue.service';

const INGEST_PATH = /\/api\/Glucose\/(sync-bulk|measurement)\b/i;
const AI_PATH = /\/api\/DietAssistant\b/i;
const HEAVY_PATH =
  /\/api\/(Glucose\/(history|summary)|Reports|Admin\/users\/[^/]+\/record)/i;

function classify(path: string): QueueLane {
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
    const request = context.switchToHttp().getRequest<{
      method?: string;
      path?: string;
      originalUrl?: string;
      url?: string;
      abortSignal?: AbortSignal;
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

    const lane = classify(path);
    return from(
      this.queue.runHttp(lane, (signal) => {
        request.abortSignal = signal;
        return lastValueFrom(next.handle());
      }),
    );
  }
}
