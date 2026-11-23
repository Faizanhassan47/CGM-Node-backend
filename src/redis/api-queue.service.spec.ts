import { RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiQueueService } from './api-queue.service';

function queueWithDefaults() {
  return new ApiQueueService({
    get: () => undefined,
  } as unknown as ConfigService);
}

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
  });

  it('rejects when ingest wait queue is full without blocking ai', async () => {
    const queue = queueWithDefaults();
    const ingestLimit = queue.snapshot().ingest.limit;
    const wait = 40;
    for (let i = 0; i < ingestLimit + wait; i += 1) {
      void queue.runHttp('ingest', () => new Promise(() => undefined)).catch(() => undefined);
    }
    await expect(
      queue.runHttp('ingest', async () => 'nope'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

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
    await expect(
      queue.runHttp('ai', async () => 'nope'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const ingestValue = await queue.runHttp('ingest', async () => 'synced');
    expect(ingestValue).toBe('synced');
  });

  it('times out light HTTP work', async () => {
    jest.useFakeTimers();
    const queue = queueWithDefaults();
    const pending = queue.runHttp('light', () => new Promise(() => undefined));
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutException);
    await jest.advanceTimersByTimeAsync(10_001);
    await assertion;
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
