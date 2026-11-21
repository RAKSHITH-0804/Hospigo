import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { OPD_REPORTS_CONFIG as C } from '../opd-reports.config';
import { REPORT_SECTIONS, REPORT_SECTIONS_PATTERN } from '../report-sections';

/**
 * Which day, and for which branches. There is NO tenant, branch id or amount here: the hospital
 * and branch come from the token. `branch=ALL` asks for every branch (needs hospital-wide access).
 */
export class DailyCollectionQueryDto {
  @ApiProperty({ description: 'YYYY-MM-DD, a day of the hospital time zone' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiPropertyOptional({
    description: `${C.allBranches} for every branch (hospital-wide access), or the id of one branch the caller may report on. Omit for the active branch.`,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  branch?: string;

  @ApiPropertyOptional({ description: 'Only this doctor (code)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  doctor?: string;

  @ApiPropertyOptional({ description: 'Only this payment mode (code)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMode?: string;

  @ApiPropertyOptional({ description: 'Only this department of the doctors' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @ApiPropertyOptional({ description: 'Only this bill type (CONSULTATION or INVESTIGATION)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  billType?: string;

  @ApiPropertyOptional({ description: 'Only bills that contain this test (code)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  test?: string;

  @ApiPropertyOptional({
    description: `Which sections the CSV and Excel files contain, comma separated (${REPORT_SECTIONS.join(', ')}). Omit for all.`,
  })
  @IsOptional()
  @IsString()
  @Matches(REPORT_SECTIONS_PATTERN)
  sections?: string;
}
