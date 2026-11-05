import { Injectable, RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';

type Job = () => void;

/**
 * One in-process queue for API work and background jobs.
 * HTTP calls wait for a slot, give up when the line is too long, and time out.
 * Background jobs wait without that limit.
 */
@Injectable()
export class ApiQueueService {
  private active = 0;
  private readonly limit = 8;
  private readonly maxWaiting = 40;
  private readonly waiting: Job[] = [];

  get depth(): number {
    return this.waiting.length;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    return this.schedule(work, false);
  }

  runHttp<T>(work: () => Promise<T>): Promise<T> {
    return this.schedule(work, true);
  }

  private schedule<T>(work: () => Promise<T>, http: boolean): Promise<T> {
    if (http && this.waiting.length >= this.maxWaiting) {
      return Promise.reject(new ServiceUnavailableException('Server is busy. Try again.'));
    }
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          this.active -= 1;
          const next = this.waiting.shift();
          if (next) next();
        };
        let settled = false;
        const finish = (ok: boolean, value: T | unknown) => {
          if (settled) return;
          settled = true;
          release();
          if (ok) resolve(value as T);
          else reject(value);
        };
        const job = Promise.resolve().then(work);
        job.then(
          (value) => finish(true, value),
          (error) => finish(false, error),
        );
        if (http) {
          setTimeout(() => finish(false, new RequestTimeoutException('Request timed out.')), 10_000);
        }
      };
      if (this.active < this.limit) start();
      else this.waiting.push(start);
    });
  }
}
