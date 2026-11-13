import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';
import type { HealthDetails } from './service-checker';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({
    schema: {
      example: { status: 'ok' },
    },
  })
  getHealth(): { status: 'ok' } {
    return this.healthService.getLiveness();
  }

  // TODO: restrict /health/details to HQ admins (later).
  @Get('details')
  @ApiOperation({ summary: 'Dependency health details' })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'degraded',
        checkedAt: '2026-01-01T00:00:00.000Z',
        services: {
          postgres: {
            status: 'down',
            responseTimeMs: 12,
            checkedAt: '2026-01-01T00:00:00.000Z',
            error: 'connect ECONNREFUSED',
          },
        },
      },
    },
  })
  getDetails(): Promise<HealthDetails> {
    return this.healthService.getDetails();
  }
}
