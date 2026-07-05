import { Module } from '@nestjs/common';
import { WatchdogService } from './watchdog.service';
import { MonitorsController } from './monitors.controller';

@Module({
  controllers: [MonitorsController],
  providers: [WatchdogService],
  exports: [WatchdogService],
})
export class WatchdogModule {}
