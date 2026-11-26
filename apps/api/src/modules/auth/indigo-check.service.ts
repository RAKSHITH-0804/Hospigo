import { Injectable } from '@nestjs/common';
import { HqPrismaService } from '../../database/hq-prisma.service';

/**
 * The one question every Indigo session asks again and again (on entering a hospital, on every
 * refresh and on every branch switch): is this Indigo person still allowed in this hospital?
 * Yes only when the Indigo user is ACTIVE, the hospital is ACTIVE, and the person is an Owner or an
 * Employee the Owner assigned to this hospital. The answer is read from the database each time,
 * never from a token. Uses the HQ database role (the only use of it for hospitals, with sign-in and
 * the hospital list).
 */
@Injectable()
export class IndigoCheckService {
  constructor(private readonly hq: HqPrismaService) {}

  async allowed(hqUserId: string, tenantId: string): Promise<boolean> {
    const person = await this.hq.hqUser.findUnique({
      where: { id: hqUserId },
      select: { isActive: true, indigoRole: true },
    });
    if (!person?.isActive) {
      return false;
    }
    const hospital = await this.hq.hospital.findUnique({
      where: { id: tenantId },
      select: { isActive: true, status: true },
    });
    if (!hospital || !hospital.isActive || hospital.status !== 'ACTIVE') {
      return false;
    }
    if (person.indigoRole === 'OWNER') {
      return true;
    }
    if (person.indigoRole !== 'EMPLOYEE') {
      return false;
    }
    const assigned = await this.hq.hqUserHospital.findUnique({
      where: { hqUserId_tenantId: { hqUserId, tenantId } },
      select: { id: true },
    });
    return assigned !== null;
  }
}
