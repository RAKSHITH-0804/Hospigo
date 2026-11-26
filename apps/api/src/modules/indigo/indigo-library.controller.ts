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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HqAccessClaims } from '../auth/token.types';
import { IndigoLibraryService, LIBRARY_LIMITS } from './indigo-library.service';
import { IndigoSetupService } from './indigo-setup.service';

type HttpReq = { auth?: AccessClaims };
const hqId = (req: HttpReq): string => (req.auth as HqAccessClaims).userId;

/**
 * Step 2.1f: the template library, terminology, one-branch module switches and the starter masters.
 * Every route needs an Indigo (HQ) token; the services decide Owner or Employee.
 */
@ApiTags('indigo-console')
@ApiBearerAuth()
@Controller('indigo')
@TokenKinds('HQ')
export class IndigoLibraryController {
  constructor(
    private readonly library: IndigoLibraryService,
    private readonly setup: IndigoSetupService,
  ) {}

  @Get('library')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The template library: templates, logos, who has what (Owner only)' })
  overview(@Req() req: HttpReq) {
    return this.library.overview(hqId(req));
  }

  @Post('library/samples')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Add the designed sample templates that are not in the library yet (Owner)',
  })
  samples(@Req() req: HttpReq) {
    return this.library.addSamples(hqId(req));
  }

  @Post('library/templates')
  @HttpCode(201)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'A new library template from a copy or a preset (Owner)' })
  createTemplate(@Req() req: HttpReq, @Body() body: unknown) {
    return this.library.createTemplate(hqId(req), body);
  }

  @Post('library/templates/:id/retire')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Take a template out of the library (hospital copies already made stay) (Owner)',
  })
  retire(@Req() req: HttpReq, @Param('id') id: string) {
    return this.library.retireTemplate(hqId(req), id);
  }

  @Post('library/logos')
  @HttpCode(201)
  @AuthenticatedOnly()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: LIBRARY_LIMITS.logoMaxBytes + 1, files: 1, fields: 0, parts: 2 },
    }),
  )
  @ApiOperation({
    summary: 'Add a logo (PNG or JPEG, one file in the field "file"; name in the query) (Owner)',
  })
  addLogo(
    @Req() req: HttpReq,
    @Query('name') name: string | undefined,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    return this.library.addLogo(hqId(req), name, file?.buffer);
  }

  @Get('library/logos/:id/image')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The picture of a library logo (Owner)' })
  async logoImage(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: { set: (headers: Record<string, string>) => void },
  ) {
    const found = await this.library.logoImage(hqId(req), id);
    res.set({
      'Content-Type': found.contentType,
      'Content-Length': String(found.data.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(found.data);
  }

  @Get('hospitals/:id/library')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'What this hospital may choose from (Owner)' })
  assigned(@Req() req: HttpReq, @Param('id') id: string) {
    return this.library.assignedTo(hqId(req), id);
  }

  @Put('hospitals/:id/library')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Set which templates and logos this hospital may choose from (Owner)' })
  assign(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.library.assign(hqId(req), id, body);
  }

  @Get('hospitals/:id/terminology')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'The words this hospital prefers (Owner, or an Employee assigned to it)',
  })
  terms(@Req() req: HttpReq, @Param('id') id: string) {
    return this.setup.terms(hqId(req), id);
  }

  @Put('hospitals/:id/terminology')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Set or clear the words of a hospital (Owner, or an assigned Employee)',
  })
  setTerms(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.setup.setTerms(hqId(req), id, body);
  }

  @Put('hospitals/:id/branches/:branchId/modules')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Switch modules on or off for ONE branch (Owner)' })
  branchModules(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    return this.setup.setBranchModules(hqId(req), id, branchId, body);
  }

  @Post('hospitals/:id/starter')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Create the starter masters (payment modes, vitals, number series) (Owner)',
  })
  starter(@Req() req: HttpReq, @Param('id') id: string) {
    return this.setup.runStarter(hqId(req), id);
  }
}
