import { Injectable, RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';

export type QueueLane = 'light' | 'heavy';

type Job = () => void;

type LaneState = {
  active: number;
  limit: number;
  maxWaiting: number;
  timeoutMs: number;
  waiting: Job[];
};

export type QueueSnapshot = {
  light: { active: number; waiting: number; limit: number };
  heavy: { active: number; waiting: number; limit: number };
  depth: number;
};

/**
 * Dual in-process queues so auth/light traffic is not blocked by sync-bulk/AI.
 * HTTP work gets an AbortSignal and times out; background jobs do not.
 */
@Injectable()
export class ApiQueueService {
  private readonly lanes: Record<QueueLane, LaneState> = {
    light: { active: 0, limit: 12, maxWaiting: 80, timeoutMs: 10_000, waiting: [] },
    heavy: { active: 0, limit: 4, maxWaiting: 24, timeoutMs: 25_000, waiting: [] },
  };

  get depth(): number {
    return this.lanes.light.waiting.length + this.lanes.heavy.waiting.length;
  }

  snapshot(): QueueSnapshot {
    const light = this.lanes.light;
    const heavy = this.lanes.heavy;
    return {
      light: { active: light.active, waiting: light.waiting.length, limit: light.limit },
      heavy: { active: heavy.active, waiting: heavy.waiting.length, limit: heavy.limit },
      depth: this.depth,
    };
  }

  /** Background / worker jobs (no HTTP timeout). Uses heavy lane capacity. */
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.schedule('heavy', work, false);
  }

  runHttp<T>(
    lane: QueueLane,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.schedule(lane, work, true);
  }

  private schedule<T>(
    laneName: QueueLane,
    work: (signal: AbortSignal) => Promise<T>,
    http: boolean,
  ): Promise<T> {
    const lane = this.lanes[laneName];
    if (http && lane.waiting.length >= lane.maxWaiting) {
      return Promise.reject(
        new ServiceUnavailableException(
          laneName === 'heavy'
            ? 'Sync queue is busy. Try again shortly.'
            : 'Server is busy. Try again.',
        ),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const start = () => {
        lane.active += 1;
        const controller = new AbortController();
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          lane.active -= 1;
          const next = lane.waiting.shift();
          if (next) next();
        };

        let settled = false;
        const finish = (ok: boolean, value: T | unknown) => {
          if (settled) return;
          settled = true;
          if (!ok && !controller.signal.aborted) {
            controller.abort();
          }
          release();
          if (ok) resolve(value as T);
          else reject(value);
        };

        let timer: ReturnType<typeof setTimeout> | undefined;
        if (http) {
          timer = setTimeout(() => {
            controller.abort();
            finish(false, new RequestTimeoutException('Request timed out.'));
          }, lane.timeoutMs);
        }

        Promise.resolve()
          .then(() => work(controller.signal))
          .then(
            (value) => {
              if (timer) clearTimeout(timer);
              finish(true, value);
            },
            (error) => {
              if (timer) clearTimeout(timer);
              if (controller.signal.aborted && !(error instanceof RequestTimeoutException)) {
                finish(false, new RequestTimeoutException('Request timed out.'));
                return;
              }
              finish(false, error);
            },
          );
      };

      if (lane.active < lane.limit) start();
      else lane.waiting.push(start);
    });
  }
}
