import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import { requireContext } from '../../common/request-context';
import { TenantDb } from '../../database/tenant-db';
import {
  RegisterPatientDto,
  UpdatePatientDto,
  UhidStartNumberDto,
} from './dto/register-patient.dto';
import { PatientsService } from './patients.service';
import type { PatientFieldPayload } from './patient-fields.service';

type HttpReq = { auth?: AccessClaims };

@ApiTags('patients')
@Controller('patients')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('form-config')
  @RequirePermission('patients.registry.read', { module: 'OPD' })
  @ApiOperation({ summary: 'Enabled patient form fields for this hospital' })
  async formConfig(@Req() req: HttpReq) {
    const { tenantId } = hospitalAuth(req);
    return this.patients.getFormConfig(tenantId);
  }

  @Get('search')
  @RequirePermission('patients.registry.read', { module: 'OPD' })
  @ApiOperation({ summary: 'Search patients by exact UHID, exact phone, or name prefix' })
  async search(
    @Req() req: HttpReq,
    @Query('uhid') uhid?: string,
    @Query('phone') phone?: string,
    @Query('name') name?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { tenantId } = hospitalAuth(req);
    return this.patients.search({
      tenantId,
      uhid,
      phone,
      namePrefix: name,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Put('uhid/start-number')
  @RequirePermission('hospital.settings.write')
  @ApiOperation({
    summary: 'Raise-only UHID start number (maps to UhidService.setStartNumber periodYear=0)',
  })
  async setUhidStart(@Req() req: HttpReq, @Body() body: UhidStartNumberDto) {
    const { tenantId, userId } = hospitalAuth(req);
    await this.patients.setUhidStartNumber({
      tenantId,
      startNumber: BigInt(body.startNumber),
      reason: body.reason,
      actorUserId: userId,
    });
    return { ok: true as const };
  }

  @Get(':id')
  @RequirePermission('patients.registry.read', { module: 'OPD' })
  @ApiOperation({ summary: 'Patient detail (writes PATIENT_VIEW audit)' })
  async detail(@Req() req: HttpReq, @Param('id') id: string) {
    const { tenantId, userId } = hospitalAuth(req);
    const ctx = requireContext();
    return this.patients.getById(tenantId, id, userId, ctx.activeBranchId);
  }

  @Post()
  @RequirePermission('patients.registry.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Register a patient at the active branch' })
  @ApiOkResponse({ schema: { example: { id: 'clx…', uhid: 'TESTA0001' } } })
  async register(@Req() req: HttpReq, @Body() body: RegisterPatientDto) {
    const { tenantId, userId, branchId } = hospitalAuth(req);
    const customValues = await this.resolveCustomValues(tenantId, body.customFieldValues);
    return this.patients.register({
      tenantId,
      registeredBranchId: branchId,
      createdBy: userId,
      name: body.name,
      gender: body.gender,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
      ageYears: body.ageYears,
      phone: body.phone,
      email: body.email,
      addressStreet: body.addressStreet,
      addressCross: body.addressCross,
      addressArea: body.addressArea,
      addressCity: body.addressCity,
      addressState: body.addressState,
      addressPincode: body.addressPincode,
      customValues,
      confirmDuplicate: body.confirmDuplicate === true,
    });
  }

  @Patch(':id')
  @RequirePermission('patients.registry.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Partial update (never uhid / registered branch)' })
  async update(@Req() req: HttpReq, @Param('id') id: string, @Body() body: UpdatePatientDto) {
    const { tenantId, userId } = hospitalAuth(req);
    if (
      body.uhid !== undefined ||
      body.registeredBranchId !== undefined ||
      body.tenantId !== undefined
    ) {
      throw new BadRequestException('uhid, tenantId and registeredBranchId cannot be changed');
    }
    const customValues = await this.resolveCustomValues(tenantId, body.customFieldValues);
    return this.patients.update(tenantId, id, userId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.gender !== undefined ? { gender: body.gender } : {}),
      ...(body.dateOfBirth !== undefined ? { dateOfBirth: new Date(body.dateOfBirth) } : {}),
      ...(body.ageYears !== undefined ? { ageYears: body.ageYears } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.addressStreet !== undefined ? { addressStreet: body.addressStreet } : {}),
      ...(body.addressCross !== undefined ? { addressCross: body.addressCross } : {}),
      ...(body.addressArea !== undefined ? { addressArea: body.addressArea } : {}),
      ...(body.addressCity !== undefined ? { addressCity: body.addressCity } : {}),
      ...(body.addressState !== undefined ? { addressState: body.addressState } : {}),
      ...(body.addressPincode !== undefined ? { addressPincode: body.addressPincode } : {}),
      ...(customValues ? { customValues } : {}),
    });
  }

  private async resolveCustomValues(
    tenantId: string,
    values?: Array<{
      code: string;
      valueText?: string | null;
      valueNumber?: number | null;
      valueDate?: string | null;
      optionId?: string | null;
    }>,
  ): Promise<PatientFieldPayload['customValues']> {
    if (!values?.length) {
      return undefined;
    }
    return this.tenantDb.withTenant(async (tx) => {
      const out: NonNullable<PatientFieldPayload['customValues']> = [];
      for (const v of values) {
        const field = await tx.patientCustomField.findUnique({
          where: { tenantId_code: { tenantId, code: v.code } },
        });
        if (!field) {
          throw new BadRequestException(`Unknown custom field code: ${v.code}`);
        }
        out.push({
          fieldId: field.id,
          valueText: v.valueText ?? null,
          valueNumber: v.valueNumber ?? null,
          valueDate: v.valueDate ? new Date(v.valueDate) : null,
          optionId: v.optionId ?? null,
        });
      }
      return out;
    });
  }
}

function hospitalAuth(req: HttpReq): {
  tenantId: string;
  userId: string;
  branchId: string;
} {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return {
    tenantId: claims.tenantId,
    userId: claims.userId,
    branchId: claims.branchId,
  };
}
