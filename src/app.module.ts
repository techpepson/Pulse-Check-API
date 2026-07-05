import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { WatchdogModule } from './watchdog/watchdog.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [PrismaModule, WatchdogModule, HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
