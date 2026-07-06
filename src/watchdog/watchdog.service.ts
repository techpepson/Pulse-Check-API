import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WatchdogService.name);
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log('Initializing Watchdog active timers from database...');
    try {
      const monitors = await this.prisma.monitor.findMany();
      const now = new Date();

      for (const monitor of monitors) {
        if (monitor.status === 'OK') {
          const expiresAt = new Date(monitor.expiresAt);
          if (expiresAt <= now) {
            // Already expired while offline, transition immediately
            this.logger.warn(
              `Monitor ${monitor.id} expired while server was offline. Triggering alert...`,
            );
            await this.triggerAlert(monitor.id);
          } else {
            // Calculate remaining time and schedule
            const remainingMs = expiresAt.getTime() - now.getTime();
            this.scheduleTimer(monitor.id, remainingMs);
            this.logger.log(
              `Rescheduled timer for ${monitor.id} with ${Math.round(remainingMs / 1000)}s remaining.`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to initialize watchdog timers on startup:',
        error,
      );
    }
  }

  onModuleDestroy() {
    this.logger.log('Clearing all active watchdog timers...');
    for (const timeout of this.timers.values()) {
      clearTimeout(timeout);
    }
    this.timers.clear();
  }

  async registerMonitor(
    id: string,
    timeoutSeconds: number,
    alertEmail: string,
  ) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000);

    const monitor = await this.prisma.monitor.upsert({
      where: { id },
      update: {
        timeout: timeoutSeconds,
        alertEmail,
        status: 'OK',
        lastPingAt: now,
        expiresAt,
      },
      create: {
        id,
        timeout: timeoutSeconds,
        alertEmail,
        status: 'OK',
        lastPingAt: now,
        expiresAt,
      },
    });

    // Clear existing timer if any
    this.clearTimer(id);

    // Schedule new timer
    this.scheduleTimer(id, timeoutSeconds * 1000);

    this.logger.log(
      `Registered monitor for ${id} with timeout ${timeoutSeconds}s.`,
    );
    return monitor;
  }

  async pingMonitor(id: string) {
    const monitor = await this.prisma.monitor.findUnique({
      where: { id },
    });

    if (!monitor) {
      return null;
    }

    const wasDown = monitor.status === 'DOWN';
    const now = new Date();
    const expiresAt = new Date(now.getTime() + monitor.timeout * 1000);

    const updatedMonitor = await this.prisma.monitor.update({
      where: { id },
      data: {
        status: 'OK',
        lastPingAt: now,
        expiresAt,
      },
    });

    // If it was down, resolve any active incidents
    if (wasDown) {
      await this.prisma.incident.updateMany({
        where: {
          monitorId: id,
          resolvedAt: null,
        },
        data: {
          resolvedAt: now,
        },
      });
      this.logger.log(
        `Monitor ${id} recovered from DOWN status. Resolved active incidents.`,
      );
    }

    // Reset / rescheduling timer
    this.clearTimer(id);
    this.scheduleTimer(id, monitor.timeout * 1000);

    this.logger.log(
      `Heartbeat received for ${id}. Reset timer to ${monitor.timeout}s.`,
    );
    return updatedMonitor;
  }

  async pauseMonitor(id: string) {
    const monitor = await this.prisma.monitor.findUnique({
      where: { id },
    });

    if (!monitor) {
      return null;
    }

    const updatedMonitor = await this.prisma.monitor.update({
      where: { id },
      data: {
        status: 'PAUSED',
      },
    });

    // Stop timer
    this.clearTimer(id);

    this.logger.log(`Monitor ${id} has been paused.`);
    return updatedMonitor;
  }

  async getMonitors() {
    return this.prisma.monitor.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        incidents: {
          orderBy: { firedAt: 'desc' },
          take: 5,
        },
      },
    });
  }

  private scheduleTimer(id: string, delayMs: number) {
    const timeout = setTimeout(async () => {
      await this.triggerAlert(id);
    }, delayMs);
    this.timers.set(id, timeout);
  }

  private clearTimer(id: string) {
    const timeout = this.timers.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timers.delete(id);
    }
  }

  private async triggerAlert(id: string) {
    try {
      const monitor = await this.prisma.monitor.findUnique({
        where: { id },
      });

      if (!monitor || monitor.status !== 'OK') {
        return;
      }

      const now = new Date();

      // Update monitor status to DOWN
      await this.prisma.monitor.update({
        where: { id },
        data: { status: 'DOWN' },
      });

      // Create new active incident
      await this.prisma.incident.create({
        data: {
          monitorId: id,
          firedAt: now,
        },
      });

      // Log the requested JSON format alert
      console.log(
        JSON.stringify({
          ALERT: `Device ${id} is down!`,
          time: now.toISOString(),
        }),
      );

      this.clearTimer(id);
    } catch (error) {
      this.logger.error(`Error triggering alert for monitor ${id}:`, error);
    }
  }
}
