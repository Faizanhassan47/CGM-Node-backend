import { Module } from '@nestjs/common';
import { WorkersService } from './workers.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
@Module({ providers: [WorkersService, FirebaseAdminService], exports: [WorkersService] })
export class WorkersModule {}
