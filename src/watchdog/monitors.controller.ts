import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  NotFoundException,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WatchdogService } from './watchdog.service';

@Controller('monitors')
export class MonitorsController {
  constructor(private readonly watchdogService: WatchdogService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() body: { id: string; timeout: number; alert_email: string },
  ) {
    const { id, timeout, alert_email } = body;
    if (!id || typeof id !== 'string') {
      throw new BadRequestException('Invalid or missing monitor ID');
    }
    if (timeout === undefined || typeof timeout !== 'number' || timeout <= 0) {
      throw new BadRequestException(
        'Invalid or missing timeout duration (must be a positive number of seconds)',
      );
    }
    if (!alert_email || typeof alert_email !== 'string') {
      throw new BadRequestException('Invalid or missing alert email');
    }

    const monitor = await this.watchdogService.registerMonitor(
      id,
      timeout,
      alert_email,
    );
    return {
      message: `Monitor for device '${id}' registered successfully. Countdown set to ${timeout} seconds.`,
      monitor,
    };
  }

  @Post(':id/heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@Param('id') id: string) {
    if (!id) {
      throw new BadRequestException('Invalid device ID');
    }

    const monitor = await this.watchdogService.pingMonitor(id);
    if (!monitor) {
      throw new NotFoundException(`Monitor with ID '${id}' not found`);
    }

    return {
      message: `Heartbeat received. Timer for device '${id}' reset.`,
      monitor,
    };
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  async pause(@Param('id') id: string) {
    if (!id) {
      throw new BadRequestException('Invalid device ID');
    }

    const monitor = await this.watchdogService.pauseMonitor(id);
    if (!monitor) {
      throw new NotFoundException(`Monitor with ID '${id}' not found`);
    }

    return {
      message: `Monitor for device '${id}' paused successfully. Alerts are disabled.`,
      monitor,
    };
  }

  @Get()
  async getAll() {
    const monitors = await this.watchdogService.getMonitors();
    return {
      count: monitors.length,
      monitors,
    };
  }
}
