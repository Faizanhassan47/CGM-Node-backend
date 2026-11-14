import { Module } from '@nestjs/common';
import { WorkersService } from './workers.service';
import { WorkerMetricsService } from './worker-metrics.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
@Module({
  providers: [WorkersService, WorkerMetricsService, FirebaseAdminService],
  exports: [WorkersService, WorkerMetricsService],
})
export class WorkersModule {}
