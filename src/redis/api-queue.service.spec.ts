import { RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiQueueService, QueueErrorBody } from './api-queue.service';
import { classifyQueueLane } from './api-queue.interceptor';

function queueWithDefaults() {
  return new ApiQueueService({
    get: () => undefined,
  } as unknown as ConfigService);
}

function queueBody(error: unknown): QueueErrorBody {
  const response = (error as ServiceUnavailableException | RequestTimeoutException).getResponse();
  return response as QueueErrorBody;
}

describe('classifyQueueLane', () => {
  it('routes ingest / ai / heavy / light correctly', () => {
    expect(classifyQueueLane('/api/Glucose/sync-bulk')).toBe('ingest');
    expect(classifyQueueLane('/api/Glucose/measurement')).toBe('ingest');
    expect(classifyQueueLane('/api/DietAssistant/chat')).toBe('ai');
    expect(classifyQueueLane('/api/Glucose/history')).toBe('heavy');
    expect(classifyQueueLane('/api/Glucose/summary')).toBe('heavy');
    expect(classifyQueueLane('/api/Reports/agp')).toBe('heavy');
    expect(classifyQueueLane('/api/wellness/meal-glucose/12')).toBe('heavy');
    expect(classifyQueueLane('/api/Family/weekly-report')).toBe('heavy');
    expect(classifyQueueLane('/api/Family/members/9/report-summary')).toBe('heavy');
    expect(classifyQueueLane('/api/Auth/login')).toBe('light');
    expect(classifyQueueLane('/api/Devices')).toBe('light');
  });
});

describe('ApiQueueService', () => {
  it('runs light HTTP work and exposes multi-lane snapshot', async () => {
    const queue = queueWithDefaults();
    const value = await queue.runHttp('light', async () => 42);
    expect(value).toBe(42);
    expect(queue.snapshot().light.limit).toBe(16);
    expect(queue.snapshot().ingest.limit).toBe(4);
    expect(queue.snapshot().heavy.limit).toBe(3);
    expect(queue.snapshot().ai.limit).toBe(2);
    expect(queue.depth).toBe(0);
    expect(queue.laneInfo('ingest').maxWaiting).toBe(40);
  });

  it('rejects when ingest wait queue is full without blocking ai', async () => {
    const queue = queueWithDefaults();
    const ingestLimit = queue.snapshot().ingest.limit;
    const wait = 40;
    for (let i = 0; i < ingestLimit + wait; i += 1) {
      void queue.runHttp('ingest', () => new Promise(() => undefined)).catch(() => undefined);
    }
    const error = await queue.runHttp('ingest', async () => 'nope').catch((e) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(queueBody(error)).toMatchObject({
      success: false,
      code: 'QUEUE_BUSY',
      lane: 'ingest',
      retryAfterMs: 1200,
    });

    const aiValue = await queue.runHttp('ai', async () => 'ok');
    expect(aiValue).toBe('ok');
  });

  it('rejects when ai wait queue is full without blocking ingest', async () => {
    const queue = queueWithDefaults();
    const aiLimit = queue.snapshot().ai.limit;
    const wait = 12;
    for (let i = 0; i < aiLimit + wait; i += 1) {
      void queue.runHttp('ai', () => new Promise(() => undefined)).catch(() => undefined);
    }
    const error = await queue.runHttp('ai', async () => 'nope').catch((e) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(queueBody(error)).toMatchObject({
      code: 'QUEUE_BUSY',
      lane: 'ai',
      retryAfterMs: 2000,
    });

    const ingestValue = await queue.runHttp('ingest', async () => 'synced');
    expect(ingestValue).toBe('synced');
  });

  it('times out light HTTP work with QUEUE_TIMEOUT body', async () => {
    jest.useFakeTimers();
    const queue = queueWithDefaults();
    const pending = queue.runHttp('light', () => new Promise(() => undefined));
    const assertion = pending.catch((error) => error);
    await jest.advanceTimersByTimeAsync(10_001);
    const error = await assertion;
    expect(error).toBeInstanceOf(RequestTimeoutException);
    expect(queueBody(error)).toMatchObject({
      success: false,
      code: 'QUEUE_TIMEOUT',
      lane: 'light',
      retryAfterMs: 800,
    });
    jest.useRealTimers();
  });

  it('uses a longer timeout for ai lane', async () => {
    jest.useFakeTimers();
    const queue = queueWithDefaults();
    const pending = queue.runHttp('ai', () => new Promise(() => undefined));
    await jest.advanceTimersByTimeAsync(25_000);
    // Still pending after heavy-lane timeout window.
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutException);
    await jest.advanceTimersByTimeAsync(20_001);
    await assertion;
    jest.useRealTimers();
  });
});
