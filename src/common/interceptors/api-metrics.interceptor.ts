import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, finalize } from 'rxjs';

@Injectable()
export class ApiMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('API_METRICS');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{
      method?: string;
      originalUrl?: string;
      route?: { path?: string };
      url?: string;
    }>();
    const response = http.getResponse<{ statusCode?: number }>();
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const route = request.route?.path ?? request.url?.split('?')[0] ?? 'unknown';
        const method = request.method ?? 'UNKNOWN';
        const status = response.statusCode ?? 500;

        this.logger.log(
          `${method} ${route} status=${status} duration=${durationMs.toFixed(1)}ms`,
        );
      }),
    );
  }
}
