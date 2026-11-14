import { Injectable } from '@nestjs/common';

@Injectable()
export class WorkerMetricsService {
  private lastDailySummaryAt?: string;
  private lastNotificationsAt?: string;
  private lastOperationsAt?: string;
  private lastDailySummaryError?: string;
  private lastNotificationsError?: string;

  markDailySummary(ok: boolean, error?: string): void {
    this.lastDailySummaryAt = new Date().toISOString();
    this.lastDailySummaryError = ok ? undefined : (error ?? 'failed');
  }

  markNotifications(ok: boolean, error?: string): void {
    this.lastNotificationsAt = new Date().toISOString();
    this.lastNotificationsError = ok ? undefined : (error ?? 'failed');
  }

  markOperations(): void {
    this.lastOperationsAt = new Date().toISOString();
  }

  snapshot() {
    return {
      lastDailySummaryAt: this.lastDailySummaryAt ?? null,
      lastNotificationsAt: this.lastNotificationsAt ?? null,
      lastOperationsAt: this.lastOperationsAt ?? null,
      lastDailySummaryError: this.lastDailySummaryError ?? null,
      lastNotificationsError: this.lastNotificationsError ?? null,
    };
  }
}
