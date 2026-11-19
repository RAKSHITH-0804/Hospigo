import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { OPD_VISITS_CONFIG as V } from '../../opd-visits/opd-visits.config';
import { OPD_REFUNDS_CONFIG as C } from '../opd-refunds.config';

class IdempotentDto {
  @ApiProperty({ description: 'One key per click. The same key again returns the same request.' })
  @IsString()
  @MinLength(V.idempotencyKeyMinLength)
  @MaxLength(V.idempotencyKeyMaxLength)
  @Matches(V.idempotencyKeyPattern)
  idempotencyKey!: string;

  @ApiProperty({ description: 'Why (kept with the request)' })
  @IsString()
  @MinLength(1)
  @MaxLength(C.reasonMaxLength)
  reason!: string;
}

/** Ask for money back on one bill. Any amount up to what was paid and not yet refunded. */
export class RequestRefundDto extends IdempotentDto {
  @ApiProperty({ description: 'Whole paise, above zero' })
  @IsInt()
  @Min(1)
  @Max(V.maxAmountPaise)
  amountPaise!: number;
}

/** Cancel a waiting visit and (optionally) return its consultation fee. */
export class RequestCancelDto extends IdempotentDto {
  @ApiPropertyOptional({
    description: 'Paise to return (0 for none). Default: everything still refundable.',
  })
  @ValidateIf((o: RequestCancelDto) => o.amountPaise !== undefined)
  @IsInt()
  @Min(0)
  @Max(V.maxAmountPaise)
  amountPaise?: number;
}

export class ApproveRefundDto {
  @ApiPropertyOptional({
    description:
      'Reference numbers by payment mode code, for modes that need one (for example UPI).',
  })
  @IsOptional()
  @IsObject()
  references?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(C.noteMaxLength)
  note?: string;
}

export class RejectRefundDto {
  @ApiProperty({ description: 'Why the request is rejected' })
  @IsString()
  @MinLength(1)
  @MaxLength(C.noteMaxLength)
  note!: string;
}
