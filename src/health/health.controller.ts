import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { RedisService } from '../common/redis.service';

@Controller()
export class HealthController {
  constructor(private readonly dataSource: DataSource, private readonly redis: RedisService) {}

  @Get('health')
  @Public()
  async health() {
    await this.dataSource.query('SELECT 1');
    return { status: 'Healthy', database: 'Healthy', timestamp: new Date().toISOString() };
  }

  @Get('health/live')
  @Public()
  live() { return { status: 'Healthy', uptimeSeconds: Math.floor(process.uptime()) }; }

  @Get('health/ready')
  @Public()
  async ready() {
    await this.dataSource.query('SELECT 1');
    await this.redis.client.ping();
    return { status: 'Ready', database: 'Healthy', redis: 'Healthy' };
  }

  @Get('metrics')
  @Public()
  metrics() { return { uptimeSeconds: Math.floor(process.uptime()), timestamp: new Date().toISOString() }; }
}
