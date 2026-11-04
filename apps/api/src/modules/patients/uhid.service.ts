import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../../database/prisma.service';
import {
  assertUhidConfigValid,
  buildUhid,
  resolvePeriodYear,
  type UhidBlockInput,
  type UhidConfigInput,
} from './uhid.util';

@Injectable()
export class UhidService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Create an immutable UHID format config + blocks in one transaction.
   * FINANCIAL_YEAR reset without a FINANCIAL_YEAR block is rejected (service + deferred DB trigger).
   */
  async createFormatConfig(input: {
    tenantId: string;
    createdBy: string;
    effectiveFrom?: Date;
    resetRule: UhidConfigInput['resetRule'];
    fyStartMonth?: number;
    timezone?: string;
    blocks: Omit<UhidBlockInput, 'position'>[] | UhidBlockInput[];
  }): Promise<{ configId: string }> {
    const blocks: UhidBlockInput[] = input.blocks.map((b, i) => ({
      position: 'position' in b && typeof b.position === 'number' ? b.position : i + 1,
      blockType: b.blockType,
      textValue: b.textValue ?? null,
      fyStyle: b.fyStyle ?? null,
      minWidth: b.minWidth ?? null,
    }));
    const config: UhidConfigInput = {
      resetRule: input.resetRule,
      fyStartMonth: input.fyStartMonth ?? 4,
      timezone: input.timezone ?? 'Asia/Kolkata',
      blocks,
    };
    assertUhidConfigValid(config);

    const configId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;
      const created = await tx.uhidFormatConfig.create({
        data: {
          tenantId: input.tenantId,
          effectiveFrom: input.effectiveFrom ?? this.clock.now(),
          resetRule: config.resetRule,
          fyStartMonth: config.fyStartMonth,
          timezone: config.timezone,
          createdBy: input.createdBy,
          blocks: {
            create: blocks.map((b) => ({
              position: b.position,
              blockType: b.blockType,
              textValue: b.textValue,
              fyStyle: b.fyStyle,
              minWidth: b.minWidth,
            })),
          },
        },
      });
      return created.id;
    });
    return { configId };
  }

  /**
   * Raise-only start-number change. Requires a reason; writes audit.
   * Permission (Indigo or hospital SuperAdmin only — NOT branch Admin) is pending auth (Step 6).
   * Method accepts actorUserId for the future check; documented as pending.
   */
  async setStartNumber(input: {
    tenantId: string;
    periodYear: number;
    nextNumber: bigint;
    reason: string;
    actorUserId: string;
  }): Promise<void> {
    if (!input.reason.trim()) {
      throw new Error('setStartNumber requires a non-empty reason');
    }
    // Pending Step 6: enforce Indigo / hospital SuperAdmin only (counter is hospital-wide).
    void input.actorUserId;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;
      const existing = await tx.uhidCounter.findUnique({
        where: {
          tenantId_periodYear: { tenantId: input.tenantId, periodYear: input.periodYear },
        },
      });
      const current = existing?.lastNumber ?? 0n;
      // nextNumber is the next value to issue; store last_number = nextNumber - 1 (raise-only).
      if (input.nextNumber <= current) {
        throw new Error('uhid counter last_number cannot be decreased (raise-only)');
      }
      const storeAs = input.nextNumber - 1n;
      await tx.uhidCounter.upsert({
        where: {
          tenantId_periodYear: { tenantId: input.tenantId, periodYear: input.periodYear },
        },
        create: {
          tenantId: input.tenantId,
          periodYear: input.periodYear,
          lastNumber: storeAs,
        },
        update: { lastNumber: storeAs },
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: 'UHID_SET_START_NUMBER',
          entityType: 'uhid_counters',
          entityId: `${input.tenantId}:${input.periodYear}`,
          reason: input.reason.trim(),
          metadata: {
            periodYear: input.periodYear,
            previousLastNumber: current.toString(),
            nextNumber: input.nextNumber.toString(),
          },
        },
      });
    });
  }

  async allocateNextUhid(input: {
    tenantId: string;
    branchId: string;
    tx: Prisma.TransactionClient;
    now?: Date;
  }): Promise<{ uhid: string; runningNumber: bigint; periodYear: number }> {
    const now = input.now ?? this.clock.now();
    await input.tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    const configs = await input.tx.uhidFormatConfig.findMany({
      where: { tenantId: input.tenantId, effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
      include: { blocks: { orderBy: { position: 'asc' } } },
    });
    const cfg = configs[0];
    if (!cfg) {
      throw new Error('No UHID format config effective for this hospital; registration refused');
    }

    const branch = await input.tx.branch.findUnique({
      where: { tenantId_id: { tenantId: input.tenantId, id: input.branchId } },
    });
    if (!branch) {
      throw new Error('Registered branch not found for tenant');
    }

    const configInput: UhidConfigInput = {
      resetRule: cfg.resetRule,
      fyStartMonth: cfg.fyStartMonth,
      timezone: cfg.timezone,
      blocks: cfg.blocks.map((b) => ({
        position: b.position,
        blockType: b.blockType,
        textValue: b.textValue,
        fyStyle: b.fyStyle,
        minWidth: b.minWidth,
      })),
    };
    assertUhidConfigValid(configInput);

    const periodYear = resolvePeriodYear(now, cfg.resetRule, cfg.fyStartMonth, cfg.timezone);

    await input.tx.$executeRaw`
      INSERT INTO uhid_counters (tenant_id, period_year, last_number)
      VALUES (${input.tenantId}, ${periodYear}, 0)
      ON CONFLICT (tenant_id, period_year) DO NOTHING
    `;
    await input.tx.$executeRaw`
      SELECT last_number FROM uhid_counters
      WHERE tenant_id = ${input.tenantId} AND period_year = ${periodYear}
      FOR UPDATE
    `;
    const updated = await input.tx.$queryRaw<Array<{ last_number: bigint }>>`
      UPDATE uhid_counters
      SET last_number = last_number + 1
      WHERE tenant_id = ${input.tenantId} AND period_year = ${periodYear}
      RETURNING last_number
    `;
    const runningNumber = updated[0]!.last_number;
    const uhid = buildUhid({
      config: configInput,
      now,
      periodYear,
      runningNumber,
      branchCode: branch.code,
    });
    return { uhid, runningNumber, periodYear };
  }
}
