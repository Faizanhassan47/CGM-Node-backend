import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FamilyController } from './family.controller';
import { GlucoseGateway } from '../realtime/glucose.gateway';
@Module({imports:[AuthModule],controllers:[FamilyController],providers:[GlucoseGateway],exports:[GlucoseGateway]})
export class FamilyModule{}
