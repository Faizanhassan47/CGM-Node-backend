import { Body, Controller, Delete, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/auth-user';
import { ChangePasswordDto, EmailDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, SocialDto, VerifyResetDto } from './auth.dto';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';

@Controller('api/Auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Public() @Post('social') social(@Body() dto: SocialDto) { return this.auth.social(dto); }
  @Public() @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Public() @Post('refresh-token') refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto); }
  @Post('logout') logout() { return { message: 'Logged out successfully.' }; }
  @Post('logout-all') logoutAll(@CurrentUser() user: AuthUser) { return this.auth.logoutAll(user.sub); }
  @Post('change-password') change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) { return this.auth.changePassword(user.sub, dto); }
  @Public() @Post('forgot-password') forgot(@Body() dto:EmailDto){return this.auth.forgot(dto);}
  @Public() @Post('verify-reset-code') verify(@Body() dto:VerifyResetDto){return this.auth.verifyReset(dto);}
  @Public() @Post('reset-password') reset(@Body() dto:ResetPasswordDto){return this.auth.reset(dto);}
  @Delete('account') delete(@CurrentUser()user:AuthUser){return this.auth.deleteAccount(user.sub);}
}
