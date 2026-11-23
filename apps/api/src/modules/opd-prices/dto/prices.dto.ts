import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { OPD_VISITS_CONFIG as V } from '../../opd-visits/opd-visits.config';
import { OPD_PRICES_CONFIG as C, VISIT_TYPES, type PriceVisitType } from '../opd-prices.config';

class PriceChangeBase {
  @ApiProperty({ description: 'The new price in whole paise (0 or more)' })
  @IsInt()
  @Min(0)
  @Max(V.maxAmountPaise)
  amountPaise!: number;

  @ApiPropertyOptional({
    description:
      'The date the price starts, YYYY-MM-DD in the hospital time zone. Not before today (the very first price of an item may be earlier). Default: today.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveFrom?: string;
}

/** A new price for the registration fee or for a test (the item is in the address). */
export class ChangeChargeItemPriceDto extends PriceChangeBase {}

/** A doctor's fee for new or follow-up visits. */
export class ChangeDoctorFeeDto extends PriceChangeBase {
  @ApiProperty()
  @IsString()
  @Matches(C.idPattern)
  doctorProfileId!: string;

  @ApiProperty({ enum: VISIT_TYPES })
  @IsIn([...VISIT_TYPES])
  visitType!: PriceVisitType;
}
