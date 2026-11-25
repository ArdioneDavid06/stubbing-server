import { Controller, Get } from '@nestjs/common';

/**
 * Liveness for the stub itself.
 *
 * The one fixture core keeps: it carries no business meaning, and every container
 * needs a healthcheck. It is separate from the stubbed routes so a compose
 * healthcheck cannot be confused with "did the stubbed call succeed".
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; now: string } {
    return { status: 'ok', now: new Date().toISOString() };
  }
}
