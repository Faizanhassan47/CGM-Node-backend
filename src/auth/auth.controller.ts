import { Body, Controller, Delete, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, AuthUser } from '../common/auth-user';
import { ChangePasswordDto, EmailDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, SocialDto, VerifyResetDto } from './auth.dto';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';

@Controller('api/Auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('social') social(@Body() dto: SocialDto) { return this.auth.social(dto); }
  @Public() @Throttle({ default: { limit: 8, ttl: 60_000 } }) @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Public() @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Post('refresh-token') refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto); }
  @Post('logout') async logout(@CurrentUser() user: AuthUser) { await this.auth.logoutAll(user.sub); return { message: 'Logged out successfully.' }; }
  @Post('logout-all') logoutAll(@CurrentUser() user: AuthUser) { return this.auth.logoutAll(user.sub); }
  @Post('change-password') change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) { return this.auth.changePassword(user.sub, dto); }
  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('forgot-password') forgot(@Body() dto:EmailDto){return this.auth.forgot(dto);}
  @Public() @Throttle({ default: { limit: 8, ttl: 60_000 } }) @Post('verify-reset-code') verify(@Body() dto:VerifyResetDto){return this.auth.verifyReset(dto);}
  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('reset-password') reset(@Body() dto:ResetPasswordDto){return this.auth.reset(dto);}
  @Delete('account') delete(@CurrentUser()user:AuthUser){return this.auth.deleteAccount(user.sub);}
}
