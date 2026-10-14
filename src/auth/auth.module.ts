import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatientProfile, User } from '../database/entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([User, PatientProfile]), PassportModule, JwtModule.registerAsync({ inject: [ConfigService], useFactory: (c: ConfigService) => ({ secret: c.getOrThrow('JWT_SECRET'), signOptions: { issuer: c.get('JWT_ISSUER') ?? 'CGM.Api', audience: c.get('JWT_AUDIENCE') ?? 'CGM.PatientApp', algorithm: 'HS256' } }) })],
  controllers: [AuthController], providers: [AuthService, JwtStrategy], exports: [JwtModule, AuthService],
})
export class AuthModule {}
