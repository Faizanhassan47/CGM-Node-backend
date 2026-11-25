import { Injectable, RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * light  — auth, profile, devices, family, wellness writes
 * ingest — Glucose sync-bulk / measurement (reserved upload capacity)
 * heavy  — history, summary, reports, meal-glucose, family reports
 * ai     — Diet Assistant (isolated from glucose sync)
 */
export type QueueLane = 'light' | 'ingest' | 'heavy' | 'ai';

export type QueueLaneInfo = {
  active: number;
  waiting: number;
  limit: number;
  maxWaiting: number;
  timeoutMs: number;
};

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
  ingest: { active: number; waiting: number; limit: number };
  heavy: { active: number; waiting: number; limit: number };
  ai: { active: number; waiting: number; limit: number };
  depth: number;
};

export type QueueErrorBody = {
  success: false;
  code: 'QUEUE_BUSY' | 'QUEUE_TIMEOUT';
  lane: QueueLane;
  message: string;
  retryAfterMs: number;
  queue: { active: number; waiting: number; limit: number; maxWaiting: number };
};

function intEnv(config: ConfigService, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(config.get<string | number>(key) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

const BUSY_MESSAGE: Record<QueueLane, string> = {
  light: 'Server is busy. Try again.',
  ingest: 'Sync queue is busy. Try again shortly.',
  heavy: 'Report queue is busy. Try again shortly.',
  ai: 'Diet assistant is busy. Try again shortly.',
};

const TIMEOUT_MESSAGE: Record<QueueLane, string> = {
  light: 'Request timed out.',
  ingest: 'Sync timed out. Try again shortly.',
  heavy: 'Report request timed out. Try again shortly.',
  ai: 'Diet assistant timed out. Try again shortly.',
};

/** Suggested client backoff when a lane rejects or times out. */
const RETRY_AFTER_MS: Record<QueueLane, number> = {
  light: 800,
  ingest: 1200,
  heavy: 1500,
  ai: 2000,
};

/**
 * Multi-lane in-process queues so auth stays responsive, glucose uploads keep
 * reserved slots, and slow AI calls cannot starve sync-bulk.
 *
 * Busy / timeout errors use a stable JSON shape the Flutter client can parse:
 * `{ success:false, code, lane, message, retryAfterMs, queue }`.
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
      // Reserved for uploads — default 4 of the former shared heavy budget of 8.
      ingest: {
        active: 0,
        limit: intEnv(config, 'API_QUEUE_INGEST_LIMIT', 4, 1, 16),
        maxWaiting: intEnv(config, 'API_QUEUE_INGEST_WAIT', 40, 8, 200),
        timeoutMs: intEnv(config, 'API_QUEUE_INGEST_TIMEOUT_MS', 25_000, 5_000, 120_000),
        waiting: [],
      },
      heavy: {
        active: 0,
        limit: intEnv(config, 'API_QUEUE_HEAVY_LIMIT', 3, 1, 32),
        maxWaiting: intEnv(config, 'API_QUEUE_HEAVY_WAIT', 40, 8, 200),
        timeoutMs: intEnv(config, 'API_QUEUE_HEAVY_TIMEOUT_MS', 25_000, 5_000, 120_000),
        waiting: [],
      },
      ai: {
        active: 0,
        limit: intEnv(config, 'API_QUEUE_AI_LIMIT', 2, 1, 8),
        maxWaiting: intEnv(config, 'API_QUEUE_AI_WAIT', 12, 2, 50),
        timeoutMs: intEnv(config, 'API_QUEUE_AI_TIMEOUT_MS', 45_000, 10_000, 120_000),
        waiting: [],
      },
    };
  }

  get depth(): number {
    return (
      this.lanes.light.waiting.length +
      this.lanes.ingest.waiting.length +
      this.lanes.heavy.waiting.length +
      this.lanes.ai.waiting.length
    );
  }

  snapshot(): QueueSnapshot {
    const { light, ingest, heavy, ai } = this.lanes;
    return {
      light: { active: light.active, waiting: light.waiting.length, limit: light.limit },
      ingest: { active: ingest.active, waiting: ingest.waiting.length, limit: ingest.limit },
      heavy: { active: heavy.active, waiting: heavy.waiting.length, limit: heavy.limit },
      ai: { active: ai.active, waiting: ai.waiting.length, limit: ai.limit },
      depth: this.depth,
    };
  }

  laneInfo(laneName: QueueLane): QueueLaneInfo {
    const lane = this.lanes[laneName];
    return {
      active: lane.active,
      waiting: lane.waiting.length,
      limit: lane.limit,
      maxWaiting: lane.maxWaiting,
      timeoutMs: lane.timeoutMs,
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

  private busyError(laneName: QueueLane): ServiceUnavailableException {
    const lane = this.lanes[laneName];
    const body: QueueErrorBody = {
      success: false,
      code: 'QUEUE_BUSY',
      lane: laneName,
      message: BUSY_MESSAGE[laneName],
      retryAfterMs: RETRY_AFTER_MS[laneName],
      queue: {
        active: lane.active,
        waiting: lane.waiting.length,
        limit: lane.limit,
        maxWaiting: lane.maxWaiting,
      },
    };
    return new ServiceUnavailableException(body);
  }

  private timeoutError(laneName: QueueLane): RequestTimeoutException {
    const lane = this.lanes[laneName];
    const body: QueueErrorBody = {
      success: false,
      code: 'QUEUE_TIMEOUT',
      lane: laneName,
      message: TIMEOUT_MESSAGE[laneName],
      retryAfterMs: RETRY_AFTER_MS[laneName],
      queue: {
        active: lane.active,
        waiting: lane.waiting.length,
        limit: lane.limit,
        maxWaiting: lane.maxWaiting,
      },
    };
    return new RequestTimeoutException(body);
  }

  private schedule<T>(
    laneName: QueueLane,
    work: (signal: AbortSignal) => Promise<T>,
    http: boolean,
  ): Promise<T> {
    const lane = this.lanes[laneName];
    if (http && lane.waiting.length >= lane.maxWaiting) {
      return Promise.reject(this.busyError(laneName));
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
            finish(false, this.timeoutError(laneName));
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
                finish(false, this.timeoutError(laneName));
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
