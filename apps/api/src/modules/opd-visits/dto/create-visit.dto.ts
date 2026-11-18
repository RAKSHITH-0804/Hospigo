import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { OPD_VISITS_CONFIG as C } from '../opd-visits.config';

export const VISIT_TYPES = ['NEW', 'FOLLOW_UP'] as const;

/**
 * "Create visit, bill and take payment" in one step.
 * There is NO branch, tenant, amount or status field: the branch comes from the token and the
 * amount from the price lists. Unknown fields are rejected (forbidNonWhitelisted).
 */
export class CreateVisitDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(C.idMaxLength)
  patientId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(C.idMaxLength)
  doctorProfileId!: string;

  @ApiProperty({ enum: VISIT_TYPES })
  @IsIn(VISIT_TYPES)
  visitType!: (typeof VISIT_TYPES)[number];

  @ApiProperty({
    description:
      'One key per click. Sending the same key again returns the same visit, bill and receipt.',
  })
  @IsString()
  @MinLength(C.idempotencyKeyMinLength)
  @MaxLength(C.idempotencyKeyMaxLength)
  @Matches(C.idempotencyKeyPattern)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Payment mode code from the master (default CASH)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(C.paymentModeCodeMaxLength)
  paymentModeCode?: string;

  @ApiPropertyOptional({ description: 'Required when the payment mode needs a reference' })
  @IsOptional()
  @IsString()
  @MaxLength(C.referenceMaxLength)
  referenceNo?: string;
}
