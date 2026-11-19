import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import { PaymentLineDto } from '../../opd-visits/dto/create-visit.dto';
import { OPD_VISITS_CONFIG as V } from '../../opd-visits/opd-visits.config';
import { OPD_INVESTIGATIONS_CONFIG as C } from '../opd-investigations.config';

/** The doctor's list of tests for the visit. PUT replaces the whole list of ORDERED tests. */
export class SaveOrdersDto {
  @ApiProperty({ type: [String], description: 'Ids from GET /opd/investigations/tests' })
  @IsArray()
  @ArrayMaxSize(C.maxTestsPerVisit)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(C.idMaxLength, { each: true })
  chargeItemIds!: string[];
}

export class NotTakenDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(C.idMaxLength)
  orderId!: string;

  @ApiProperty({ description: 'Why the patient will not take this test' })
  @IsString()
  @MinLength(1)
  @MaxLength(C.reasonMaxLength)
  reason!: string;
}

/**
 * Bill the tests the patient will take (one bill, one receipt, one or several payment modes).
 * No amount, price, branch or status can be sent: prices come from the price list.
 */
export class BillInvestigationsDto {
  @ApiProperty({
    description: 'One key per click. Sending the same key again returns the same bill and receipt.',
  })
  @IsString()
  @MinLength(V.idempotencyKeyMinLength)
  @MaxLength(V.idempotencyKeyMaxLength)
  @Matches(V.idempotencyKeyPattern)
  idempotencyKey!: string;

  @ApiProperty({ type: [String], description: 'Order ids the patient will take (billed)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(C.maxTestsPerVisit)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(C.idMaxLength, { each: true })
  orderIds!: string[];

  @ApiPropertyOptional({
    type: [NotTakenDto],
    description: 'Ordered tests the patient declines: marked not taken with a reason, never billed',
  })
  @ValidateIf((o: BillInvestigationsDto) => o.notTaken !== undefined)
  @IsArray()
  @ArrayMaxSize(C.maxTestsPerVisit)
  @ValidateNested({ each: true })
  @Type(() => NotTakenDto)
  notTaken?: NotTakenDto[];

  @ApiPropertyOptional({
    description: 'The total (paise) the screen showed; another total now means 409 PRICE_CHANGED.',
  })
  @ValidateIf((o: BillInvestigationsDto) => o.expectedTotalPaise !== undefined)
  @IsInt()
  @Min(0)
  @Max(V.maxAmountPaise)
  expectedTotalPaise?: number;

  @ApiPropertyOptional({ type: [PaymentLineDto] })
  @ValidateIf((o: BillInvestigationsDto) => o.payments !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(V.maxPaymentLines)
  @ValidateNested({ each: true })
  @Type(() => PaymentLineDto)
  payments?: PaymentLineDto[];

  @ApiPropertyOptional({ description: 'Payment mode code (default CASH)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(V.paymentModeCodeMaxLength)
  paymentModeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(V.referenceMaxLength)
  referenceNo?: string;
}
