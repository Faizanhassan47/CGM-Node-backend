import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';

@Controller()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('health')
  @Public()
  async health() {
    return this.readiness();
  }

  @Get('health/live')
  @Public()
  live() {
    return { status: 'Healthy', timestamp: new Date().toISOString() };
  }

  @Get('health/ready')
  @Public()
  async readiness() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        status: 'Unhealthy', database: 'Unhealthy', timestamp: new Date().toISOString(),
      });
    }
    return { status: 'Healthy', database: 'Healthy', timestamp: new Date().toISOString() };
  }

  @Get('metrics')
  @Public()
  metrics() { return { uptimeSeconds: Math.floor(process.uptime()), timestamp: new Date().toISOString() }; }
}
