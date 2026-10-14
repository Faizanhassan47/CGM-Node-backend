import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatientProfile, User } from '../database/entities';
import { AlertRulesController, AlertsController } from './alerts.controller';
import { AdminController, AppVersionController, ArticlesController, DeviceHardwareController, DictionariesController, NotificationEndpointsController } from './misc.controller';
import { ProfileController } from './profile.controller';
import { ReportsController } from './reports.controller';
import { AccountController } from './account.controller';
import { AuthModule } from '../auth/auth.module';
@Module({imports:[TypeOrmModule.forFeature([User,PatientProfile]),AuthModule],controllers:[ProfileController,AlertsController,AlertRulesController,NotificationEndpointsController,AppVersionController,ArticlesController,DictionariesController,DeviceHardwareController,AdminController,ReportsController,AccountController]})
export class CompatModule{}
