import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlucoseMeasurement } from '../database/entities';
import { DailyActivityLog, MealLog, MealReminderSchedule, WaterIntakeLog, WellnessReminderSettings } from './wellness.entities';
import { WellnessController } from './wellness.controller';
import { WellnessService } from './wellness.service';
@Module({ imports: [TypeOrmModule.forFeature([WellnessReminderSettings, MealReminderSchedule, MealLog, WaterIntakeLog, DailyActivityLog, GlucoseMeasurement])], controllers: [WellnessController], providers: [WellnessService] })
export class WellnessModule {}
