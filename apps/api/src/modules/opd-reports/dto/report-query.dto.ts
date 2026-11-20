import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { OPD_REPORTS_CONFIG as C } from '../opd-reports.config';

/**
 * Which day, and for which branches. There is NO tenant, branch id or amount here: the hospital
 * and branch come from the token. `branch=ALL` asks for every branch (needs hospital-wide access).
 */
export class DailyCollectionQueryDto {
  @ApiProperty({ description: 'YYYY-MM-DD, a day of the hospital time zone' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiPropertyOptional({ enum: [C.allBranches], description: 'Omit for the active branch only' })
  @IsOptional()
  @IsIn([C.allBranches])
  branch?: typeof C.allBranches;
}
