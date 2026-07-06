import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let dbStatus = 'UP';
    let errorMsg = null;

    try {
      // Execute a lightweight query to verify DB connection is active
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      dbStatus = 'DOWN';
      errorMsg = error.message;
    }
    
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const memoryUsage = process.memoryUsage();

    const healthReport = {
      status: dbStatus === 'UP' ? 'OK' : 'ERROR',
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      uptimeFormatted: this.formatUptime(uptimeSeconds),
      services: {
        database: {
          status: dbStatus,
          error: errorMsg ? errorMsg : undefined,
        },
      },
      system: {
        memory: {
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
        },
      },
    };

    if (dbStatus === 'DOWN') {
      throw new ServiceUnavailableException(healthReport);
    }

    return healthReport;
  }

  private formatUptime(seconds: number): string {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }
}
