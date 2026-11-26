import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OPD_VISITS_CONFIG as C } from '../opd-visits.config';

export const VISIT_TYPES = ['NEW', 'FOLLOW_UP'] as const;

/**
 * What the price depends on: patient, doctor and visit type. Used by the price preview and,
 * extended, by "create visit". There is NO branch, tenant, amount or status field: the branch
 * comes from the token and the amount from the price lists. Unknown fields are rejected.
 */
export class PreviewVisitDto {
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
}

/** One payment line of a split payment (one payment mode and its amount). */
export class PaymentLineDto {
  @ApiProperty({ description: 'Payment mode code from the master' })
  @IsString()
  @MinLength(1)
  @MaxLength(C.paymentModeCodeMaxLength)
  paymentModeCode!: string;

  @ApiProperty({ description: 'Whole paise, above zero' })
  @IsInt()
  @Min(1)
  @Max(C.maxAmountPaise)
  amountPaise!: number;

  @ApiPropertyOptional({ description: 'Required when the payment mode needs a reference' })
  @IsOptional()
  @IsString()
  @MaxLength(C.referenceMaxLength)
  referenceNo?: string;
}

/** "Create visit, bill and take payment" in one step. */
export class CreateVisitDto extends PreviewVisitDto {
  @ApiPropertyOptional({
    description:
      'The total (paise) the screen showed. If the server now calculates a different total the call is refused with 409 PRICE_CHANGED and nothing is charged.',
  })
  // Absent is fine; a present value (even null) must be a whole number.
  @ValidateIf((o: CreateVisitDto) => o.expectedTotalPaise !== undefined)
  @IsInt()
  @Min(0)
  @Max(C.maxAmountPaise)
  expectedTotalPaise?: number;

  @ApiProperty({
    description:
      'One key per click. Sending the same key again returns the same visit, bill and receipt.',
  })
  @IsString()
  @MinLength(C.idempotencyKeyMinLength)
  @MaxLength(C.idempotencyKeyMaxLength)
  @Matches(C.idempotencyKeyPattern)
  idempotencyKey!: string;

  @ApiPropertyOptional({
    type: [PaymentLineDto],
    description:
      'Split payment: one line per payment mode, amounts must add up exactly to the total. One receipt covers all lines. Do not combine with paymentModeCode / referenceNo.',
  })
  // Absent is fine; a present value (even null) must be a proper list.
  @ValidateIf((o: CreateVisitDto) => o.payments !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(C.maxPaymentLines)
  @ValidateNested({ each: true })
  @Type(() => PaymentLineDto)
  payments?: PaymentLineDto[];

  @ApiPropertyOptional({
    description:
      'Symptoms the patient told reception (optional, up to 500 characters). Editable until the doctor starts the consultation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  receptionSymptoms?: string;

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

/** Symptoms typed by reception; an empty text clears them. Only until the doctor starts. */
export class UpdateReceptionSymptomsDto {
  @ApiProperty({ description: 'Up to 500 characters; empty clears' })
  @IsString()
  @MaxLength(500)
  receptionSymptoms!: string;
}
