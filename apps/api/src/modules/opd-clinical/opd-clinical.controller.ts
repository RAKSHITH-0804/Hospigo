import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import type { Actor } from '../opd-visits/opd-visits.service';
import { ConsultationService } from './consultation.service';
import { AddendumDto, RecordVitalsDto, SaveNoteDto, SavePrescriptionDto } from './dto/clinical.dto';
import { OPD_CLINICAL_CONFIG as C } from './opd-clinical.config';
import { VitalsService } from './vitals.service';

type HttpReq = { auth?: AccessClaims };

/** Branch, tenant and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq): Actor {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

@ApiTags('opd-clinical')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class OpdClinicalController {
  constructor(
    private readonly consultations: ConsultationService,
    private readonly vitals: VitalsService,
  ) {}

  // ---------------------------------------------------------------------------- medicines

  @Get('opd/medicines')
  @RequirePermission('opd.masters.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Search the active medicines list (name, code or composition) for the prescription picker',
  })
  async medicines(@Req() req: HttpReq, @Query('q') q?: string, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.consultations.searchMedicines(
      actorOf(req),
      typeof q === 'string' ? q : '',
      Number.isInteger(n) && n > 0 ? n : C.medicineSearchDefaultLimit,
    );
  }

  // ----------------------------------------------------------------------- queue and note

  @Get('opd/queue')
  @RequirePermission('opd.queue.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      "Today's waiting and in-consultation visits of the active branch in payment order. A doctor sees only their own queue.",
  })
  async queue(@Req() req: HttpReq) {
    return this.consultations.queue(actorOf(req));
  }

  @Post('opd/visits/:id/start')
  @HttpCode(200)
  @RequirePermission('opd.notes.write', { module: 'OPD' })
  @ApiOperation({
    summary: 'The assigned doctor starts the consultation (waiting -> in consultation)',
  })
  async start(@Req() req: HttpReq, @Param('id') id: string) {
    return this.consultations.start(id, actorOf(req));
  }

  @Get('opd/visits/:id/consultation')
  @RequirePermission('opd.notes.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Note, prescription and addenda of one visit (doctor: own visit; nurse: any visit of the branch). Every read is audited.',
  })
  async note(@Req() req: HttpReq, @Param('id') id: string) {
    return this.consultations.getNote(id, actorOf(req));
  }

  @Put('opd/visits/:id/consultation')
  @HttpCode(200)
  @RequirePermission('opd.notes.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Save the draft note (replaces the four note fields)' })
  async saveNote(@Req() req: HttpReq, @Param('id') id: string, @Body() body: SaveNoteDto) {
    return this.consultations.saveNote(id, body, actorOf(req));
  }

  @Put('opd/visits/:id/prescription')
  @HttpCode(200)
  @RequirePermission('opd.notes.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Replace the whole prescription of the draft note' })
  async savePrescription(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Body() body: SavePrescriptionDto,
  ) {
    return this.consultations.savePrescription(id, body, actorOf(req));
  }

  @Post('opd/visits/:id/complete')
  @HttpCode(200)
  @RequirePermission('opd.notes.write', { module: 'OPD' })
  @ApiOperation({
    summary: 'Complete the note and the visit. A completed note can no longer be edited.',
  })
  async complete(@Req() req: HttpReq, @Param('id') id: string) {
    return this.consultations.complete(id, actorOf(req));
  }

  @Post('opd/visits/:id/consultation/addenda')
  @HttpCode(201)
  @RequirePermission('opd.notes.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Correct a completed note with an addendum (who, when, why)' })
  async addendum(@Req() req: HttpReq, @Param('id') id: string, @Body() body: AddendumDto) {
    return this.consultations.addAddendum(id, body, actorOf(req));
  }

  // ----------------------------------------------------------------------------- vitals

  @Get('opd/vitals-fields')
  @RequirePermission('opd.vitals.read', { module: 'OPD' })
  @ApiOperation({ summary: 'The active vitals fields (name, unit, kind, warning range)' })
  async vitalsFields(@Req() req: HttpReq) {
    return this.vitals.listFields(actorOf(req));
  }

  @Get('opd/visits/:id/vitals')
  @RequirePermission('opd.vitals.read', { module: 'OPD' })
  @ApiOperation({ summary: 'Current vitals of one visit with the full correction history' })
  async visitVitals(@Req() req: HttpReq, @Param('id') id: string) {
    return this.vitals.getForVisit(id, actorOf(req));
  }

  @Post('opd/visits/:id/vitals')
  @HttpCode(200)
  @RequirePermission('opd.vitals.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Record or correct vitals (all or nothing). A different value for a field that already has a reading is a correction and needs a reason.',
  })
  async recordVitals(@Req() req: HttpReq, @Param('id') id: string, @Body() body: RecordVitalsDto) {
    return this.vitals.record(id, body, actorOf(req));
  }
}
