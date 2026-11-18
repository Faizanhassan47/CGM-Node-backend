import { RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiQueueService } from './api-queue.service';

function queueWithDefaults() {
  return new ApiQueueService({
    get: () => undefined,
  } as unknown as ConfigService);
}

describe('ApiQueueService', () => {
  it('runs light HTTP work and exposes depth', async () => {
    const queue = queueWithDefaults();
    const value = await queue.runHttp('light', async () => 42);
    expect(value).toBe(42);
    expect(queue.snapshot().light.limit).toBe(16);
    expect(queue.snapshot().heavy.limit).toBe(8);
    expect(queue.depth).toBe(0);
  });

  it('rejects when heavy wait queue is full', async () => {
    const queue = queueWithDefaults();
    const heavyLimit = queue.snapshot().heavy.limit;
    const wait = 40;
    for (let i = 0; i < heavyLimit + wait; i += 1) {
      void queue.runHttp('heavy', () => new Promise(() => undefined)).catch(() => undefined);
    }
    await expect(
      queue.runHttp('heavy', async () => 'nope'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
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
});
