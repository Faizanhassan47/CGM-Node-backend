import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { ApiQueueService } from './api-queue.service';

@Injectable()
export class ApiQueueInterceptor implements NestInterceptor {
  constructor(private readonly queue: ApiQueueService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{ method?: string; path?: string }>();
    const path = request.path ?? '';
    if (request.method === 'GET' && (path === '/' || path === '/health' || path.endsWith('/health'))) {
      return next.handle();
    }
    return from(this.queue.runHttp(() => lastValueFrom(next.handle())));
  }
}
