import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';

@Controller()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('health')
  @Public()
  async health() {
    await this.dataSource.query('SELECT 1');
    return { status: 'Healthy', database: 'Healthy', timestamp: new Date().toISOString() };
  }

  @Get('metrics')
  @Public()
  metrics() { return { uptimeSeconds: Math.floor(process.uptime()), timestamp: new Date().toISOString() }; }
}
