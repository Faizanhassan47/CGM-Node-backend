import { Injectable, RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

function intEnv(config: ConfigService, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(config.get<string | number>(key) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

/**
 * Dual in-process queues so auth/light traffic is not blocked by sync-bulk/AI.
 * Limits are env-tunable for capacity changes without code edits.
 */
@Injectable()
export class ApiQueueService {
  private readonly lanes: Record<QueueLane, LaneState>;

  constructor(config: ConfigService) {
    this.lanes = {
      light: {
        active: 0,
        limit: intEnv(config, 'API_QUEUE_LIGHT_LIMIT', 16, 4, 64),
        maxWaiting: intEnv(config, 'API_QUEUE_LIGHT_WAIT', 100, 10, 500),
        timeoutMs: intEnv(config, 'API_QUEUE_LIGHT_TIMEOUT_MS', 10_000, 3_000, 60_000),
        waiting: [],
      },
      heavy: {
        active: 0,
        limit: intEnv(config, 'API_QUEUE_HEAVY_LIMIT', 8, 2, 32),
        maxWaiting: intEnv(config, 'API_QUEUE_HEAVY_WAIT', 40, 8, 200),
        timeoutMs: intEnv(config, 'API_QUEUE_HEAVY_TIMEOUT_MS', 25_000, 5_000, 120_000),
        waiting: [],
      },
    };
  }

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
