import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30000);

describe('Watchdog Sentinel API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const testDeviceId = 'e2e-test-device';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    // Cleanup any leftovers from previous test runs
    try {
      await prisma.monitor.delete({ where: { id: testDeviceId } }).catch(() => {});
    } catch (e) {}
  });

  afterAll(async () => {
    // 1. Close app first to clear any active watchdog timers via onModuleDestroy
    await app.close();

    // 2. Safe cleanup of the database
    try {
      await prisma.monitor.delete({ where: { id: testDeviceId } }).catch(() => {});
    } catch (e) {}
  });

  describe('/health (GET)', () => {
    it('should return server health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('services.database.status', 'UP');
      expect(response.body).toHaveProperty('system.memory');
    });
  });

  describe('/monitors (POST)', () => {
    it('should register a new monitor', async () => {
      const response = await request(app.getHttpServer())
        .post('/monitors')
        .send({
          id: testDeviceId,
          timeout: 2, // 2 seconds timeout for quick expiration testing
          alert_email: 'test-admin@critmon.com',
        })
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body.monitor).toHaveProperty('id', testDeviceId);
      expect(response.body.monitor).toHaveProperty('status', 'OK');
      expect(response.body.monitor).toHaveProperty('timeout', 2);
    });

    it('should fail registration if missing parameter', async () => {
      await request(app.getHttpServer())
        .post('/monitors')
        .send({
          id: testDeviceId,
          // missing timeout
          alert_email: 'test-admin@critmon.com',
        })
        .expect(400);
    });
  });

  describe('/monitors/:id/heartbeat (POST)', () => {
    it('should reset heartbeat timer and return 200', async () => {
      const response = await request(app.getHttpServer())
        .post(`/monitors/${testDeviceId}/heartbeat`)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.monitor).toHaveProperty('status', 'OK');
    });

    it('should return 404 for unknown device', async () => {
      await request(app.getHttpServer())
        .post('/monitors/non-existent-device/heartbeat')
        .expect(404);
    });
  });

  describe('/monitors/:id/pause (POST)', () => {
    it('should pause monitor and return 200', async () => {
      const response = await request(app.getHttpServer())
        .post(`/monitors/${testDeviceId}/pause`)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.monitor).toHaveProperty('status', 'PAUSED');
    });

    it('should return 404 for pausing unknown device', async () => {
      await request(app.getHttpServer())
        .post('/monitors/non-existent-device/pause')
        .expect(404);
    });
  });

  describe('Heartbeat resumes paused monitor', () => {
    it('should automatically unpause when receiving heartbeat', async () => {
      const response = await request(app.getHttpServer())
        .post(`/monitors/${testDeviceId}/heartbeat`)
        .expect(200);

      expect(response.body.monitor).toHaveProperty('status', 'OK');
    });
  });

  describe('Downtime Detection / Expiry', () => {
    it('should change status to DOWN and print alert after timeout', async () => {
      // Re-register with 1s timeout
      await request(app.getHttpServer())
        .post('/monitors')
        .send({
          id: testDeviceId,
          timeout: 1,
          alert_email: 'test-admin@critmon.com',
        })
        .expect(201);

      // Wait 1.5 seconds for timeout to occur
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Check listing endpoint to see if monitor transitioned to DOWN
      const listResponse = await request(app.getHttpServer())
        .get('/monitors')
        .expect(200);

      const testDevice = listResponse.body.monitors.find(
        (m: any) => m.id === testDeviceId,
      );

      expect(testDevice).toBeDefined();
      expect(testDevice.status).toBe('DOWN');
      expect(testDevice.incidents.length).toBeGreaterThan(0);
      expect(testDevice.incidents[0].resolvedAt).toBeNull();
    });

    it('should resolve incident when a device pings again after going DOWN', async () => {
      // Send heartbeat
      await request(app.getHttpServer())
        .post(`/monitors/${testDeviceId}/heartbeat`)
        .expect(200);

      // Verify incident is resolved
      const listResponse = await request(app.getHttpServer())
        .get('/monitors')
        .expect(200);

      const testDevice = listResponse.body.monitors.find(
        (m: any) => m.id === testDeviceId,
      );

      expect(testDevice.status).toBe('OK');
      expect(testDevice.incidents[0].resolvedAt).not.toBeNull();
    });
  });
});
