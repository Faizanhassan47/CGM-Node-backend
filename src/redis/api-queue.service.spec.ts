import { RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { ApiQueueService } from './api-queue.service';

describe('ApiQueueService', () => {
  it('runs light HTTP work and exposes depth', async () => {
    const queue = new ApiQueueService();
    const value = await queue.runHttp('light', async () => 42);
    expect(value).toBe(42);
    expect(queue.snapshot().light.limit).toBe(12);
    expect(queue.depth).toBe(0);
  });

  it('rejects when heavy wait queue is full', async () => {
    const queue = new ApiQueueService();
    // Fill active (4) + waiting (24) without awaiting holders.
    for (let i = 0; i < 28; i += 1) {
      void queue.runHttp('heavy', () => new Promise(() => undefined)).catch(() => undefined);
    }
    await expect(
      queue.runHttp('heavy', async () => 'nope'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('times out light HTTP work', async () => {
    jest.useFakeTimers();
    const queue = new ApiQueueService();
    const pending = queue.runHttp('light', () => new Promise(() => undefined));
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutException);
    await jest.advanceTimersByTimeAsync(10_001);
    await assertion;
    jest.useRealTimers();
  });
});
