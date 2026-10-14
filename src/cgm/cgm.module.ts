import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CgmDevice, GlucoseMeasurement, Sensor } from '../database/entities';
import { DevicesController } from './devices.controller';
import { GlucoseController } from './glucose.controller';
import { SensorsController } from './sensors.controller';
import { FamilyModule } from '../family/family.module';
import { WorkersModule } from '../workers/workers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CgmDevice, Sensor, GlucoseMeasurement]),
    FamilyModule,
    WorkersModule,
  ],
  controllers: [DevicesController, SensorsController, GlucoseController],
})
export class CgmModule {}
