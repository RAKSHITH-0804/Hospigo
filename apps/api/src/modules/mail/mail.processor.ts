import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { ApiEnv } from '../../config/env';
import { runWithContext } from '../../common/request-context';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { TenantDb } from '../../database/tenant-db';
import { AuthActionPurpose } from '../../generated/prisma';
import { ActionTokenService } from '../auth/action-token.service';
import { MAIL_PROVIDER, type MailProvider } from './mail.provider';
import { activationEmail, passwordResetEmail } from './mail.templates';
import { MAIL_QUEUE_NAME, type MailJobData } from './mail.types';

@Injectable()
export class MailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailProcessor.name);
  private worker: Worker<MailJobData> | undefined;
  private connection: Redis | undefined;

  constructor(
    private readonly tokens: ActionTokenService,
    private readonly tenantDb: TenantDb,
    private readonly hqPrisma: HqPrismaService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.getOrThrow('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.worker = new Worker<MailJobData>(MAIL_QUEUE_NAME, async (job) => this.process(job), {
      connection: this.connection,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        `Mail job failed id=${job?.id ?? 'unknown'} kind=${job?.data.kind ?? '?'} err=${err.message}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
  }

  private async process(job: Job<MailJobData>): Promise<void> {
    const { kind, tenantId, userId } = job.data;
    if (kind === 'HQ_PASSWORD_RESET') {
      await this.processHqReset(userId);
      return;
    }
    if (!tenantId) {
      throw new Error('tenantId required for hospital mail job');
    }
    await this.processHospital(kind, tenantId, userId);
  }

  private async processHospital(
    kind: 'ACTIVATION' | 'PASSWORD_RESET',
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const requestId = randomUUID();
    await runWithContext(
      {
        tenantId,
        userId,
        kind: 'HOSPITAL',
        activeBranchId: null,
        requestId,
      },
      async () => {
        const user = await this.tenantDb.withTenant((tx) =>
          tx.user.findFirst({ where: { id: userId, isActive: true } }),
        );
        if (!user) {
          this.logger.warn(`Mail job skipped missing user userId=${userId}`);
          return;
        }
        const purpose =
          kind === 'ACTIVATION' ? AuthActionPurpose.ACTIVATION : AuthActionPurpose.PASSWORD_RESET;
        const { rawToken } = await this.tokens.createHospitalToken({
          tenantId,
          userId,
          purpose,
          requestId,
        });
        const link =
          kind === 'ACTIVATION'
            ? this.tokens.buildActivationLink(rawToken)
            : this.tokens.buildResetLink(rawToken);
        const content = kind === 'ACTIVATION' ? activationEmail(link) : passwordResetEmail(link);
        await this.mail.send({
          to: user.email,
          subject: content.subject,
          text: content.text,
          html: content.html,
        });
      },
    );
  }

  private async processHqReset(userId: string): Promise<void> {
    const user = await this.hqPrisma.hqUser.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      this.logger.warn(`HQ mail job skipped missing user userId=${userId}`);
      return;
    }
    const { rawToken } = await this.tokens.createHqResetToken({ hqUserId: userId });
    const link = this.tokens.buildResetLink(rawToken);
    const content = passwordResetEmail(link);
    await this.mail.send({
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }
}
