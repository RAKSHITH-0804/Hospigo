import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import type { Actor } from '../opd-visits/opd-visits.service';
import { DailyCollectionService } from './daily-collection.service';
import { DailyCollectionQueryDto } from './dto/report-query.dto';
import { OPD_REPORTS_CONFIG as C } from './opd-reports.config';
import { buildReportXlsx } from './report-xlsx';
import { parseSections } from './report-sections';

type HttpReq = { auth?: AccessClaims };
type HttpRes = { setHeader: (name: string, value: string) => unknown };

/** Branch, tenant and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq): Actor {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

@ApiTags('opd-reports')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class OpdReportsController {
  constructor(private readonly reports: DailyCollectionService) {}

  @Get('opd/reports/filters')
  @RequirePermission('opd.reports.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      'The values the report screen offers in its dropdowns: branches by name, doctors, payment modes, departments, bill types and tests of this hospital',
  })
  async filters(@Req() req: HttpReq) {
    return this.reports.filterOptions(actorOf(req));
  }

  @Get('opd/reports/daily-collection')
  @RequirePermission('opd.reports.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Daily collection of the active branch (or branch=ALL with hospital-wide access): by payment mode, by doctor, by bill type; refunds separate; checked against the ledger',
  })
  async daily(@Req() req: HttpReq, @Query() query: DailyCollectionQueryDto) {
    return this.reports.report(actorOf(req), query);
  }

  @Get('opd/reports/daily-collection.csv')
  @RequirePermission('opd.reports.read', { module: 'OPD' })
  @ApiOperation({
    summary: 'The same report as a CSV file (amounts in rupees; text cells cannot run as formulas)',
  })
  async dailyCsv(
    @Req() req: HttpReq,
    @Query() query: DailyCollectionQueryDto,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const report = await this.reports.report(actorOf(req), query, 'EXPORT');
    res.setHeader('Content-Type', C.csvContentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${C.csvFileNamePrefix}${report.date}${report.combined ? '-all' : ''}.csv"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return this.reports.toCsv(report, parseSections(query.sections));
  }

  @Get('opd/reports/daily-collection.xlsx')
  @RequirePermission('opd.reports.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      'The same report as an Excel workbook: a Summary sheet and one sheet per chosen section (amounts are numbers in rupees; text can never run as a formula)',
  })
  async dailyXlsx(
    @Req() req: HttpReq,
    @Query() query: DailyCollectionQueryDto,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const report = await this.reports.report(actorOf(req), query, 'EXPORT');
    res.setHeader('Content-Type', C.xlsxContentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${C.csvFileNamePrefix}${report.date}${report.combined ? '-all' : ''}.xlsx"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    // A file must go out as bytes: a bare Buffer would be turned into JSON text by Nest.
    return new StreamableFile(await buildReportXlsx(report, parseSections(query.sections)));
  }
}
