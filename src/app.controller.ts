import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  @Get()
  @Public()
  root() { return 'CGM API is running. Production Environment Active.'; }
}
