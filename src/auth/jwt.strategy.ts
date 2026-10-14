import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Repository } from 'typeorm';
import { User } from '../database/entities';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, @InjectRepository(User) private readonly users: Repository<User>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      issuer: config.get<string>('JWT_ISSUER') ?? 'CGM.Api',
      audience: config.get<string>('JWT_AUDIENCE') ?? 'CGM.PatientApp',
    });
  }
  async validate(payload: { sub: string; email: string; token_type?: string; token_version?: number }) {
    if (payload.token_type === 'refresh') throw new UnauthorizedException();
    const user = await this.users.findOneBy({ id: Number(payload.sub), isActive: true });
    if (!user) throw new UnauthorizedException();
    return { sub: user.id, email: user.email, tokenVersion: user.tokenVersion };
  }
}
