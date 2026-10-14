import { Controller, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { AuthService } from '../auth/auth.service';
@Controller('api/Account')
export class AccountController{constructor(private auth:AuthService){}@Post('logout-all')logout(@CurrentUser()u:AuthUser){return this.auth.logoutAll(u.sub);}}
