import { Injectable } from '@nestjs/common';
import { HqPrismaService } from '../../database/hq-prisma.service';

export type HqHospital = { id: string; code: string; name: string };

/**
 * Which hospitals an HQ person works on (Phase 2.2). HQ never enters a hospital: this is only the
 * list for the HQ console. An HQ Admin ('OWNER' in the database) sees every active hospital; HQ Staff
 * ('EMPLOYEE') only the hospitals an HQ Admin ticked for them. Read from the database every time,
 * never from a token.
 */
@Injectable()
export class HqScopeService {
  constructor(private readonly hq: HqPrismaService) {}

  async hospitals(hqUserId: string): Promise<HqHospital[]> {
    const person = await this.hq.hqUser.findUnique({
      where: { id: hqUserId },
      select: { isActive: true, indigoRole: true },
    });
    if (!person?.isActive) {
      return [];
    }
    let assignedIds: string[] | null = null;
    if (person.indigoRole === 'EMPLOYEE') {
      const rows = await this.hq.hqUserHospital.findMany({
        where: { hqUserId },
        select: { tenantId: true },
      });
      assignedIds = rows.map((row) => row.tenantId);
    } else if (person.indigoRole !== 'OWNER') {
      return [];
    }
    return this.hq.hospital.findMany({
      where: {
        isActive: true,
        status: 'ACTIVE',
        ...(assignedIds ? { id: { in: assignedIds } } : {}),
      },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
