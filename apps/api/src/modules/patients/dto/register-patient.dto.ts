import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CustomFieldValueDto {
  @ApiProperty({ example: 'title' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  valueText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  valueNumber?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  valueDate?: string | null;

  @ApiPropertyOptional({ description: 'Dropdown option id' })
  @IsOptional()
  @IsString()
  optionId?: string | null;
}

export class RegisterPatientDto {
  @ApiProperty({ example: 'Mock Patient One' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'F' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  gender?: string;

  @ApiPropertyOptional({ example: '1990-05-15' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: 34,
    description: 'Alternative to dateOfBirth; sets dobIsEstimated',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(150)
  ageYears?: number;

  @ApiPropertyOptional({ example: 5, description: 'With ageYears: months (0 to 11)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(11)
  ageMonths?: number;

  @ApiPropertyOptional({ example: 12, description: 'With ageYears: days (0 to 30)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  ageDays?: number;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressStreet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressCross?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressArea?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressPincode?: string;

  @ApiPropertyOptional({ type: [CustomFieldValueDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomFieldValueDto)
  customFieldValues?: CustomFieldValueDto[];

  @ApiPropertyOptional({
    description: 'Set true to proceed when POSSIBLE_DUPLICATE was returned',
  })
  @IsOptional()
  // The raw value is kept: implicit conversion would turn the text "false" into true.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.confirmDuplicate)
  @IsBoolean()
  confirmDuplicate?: boolean;
}

export class UpdatePatientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(150)
  ageYears?: number;

  @ApiPropertyOptional({ example: 5, description: 'With ageYears: months (0 to 11)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(11)
  ageMonths?: number;

  @ApiPropertyOptional({ example: 12, description: 'With ageYears: days (0 to 30)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  ageDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressStreet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressCross?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressArea?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressPincode?: string;

  @ApiPropertyOptional({ type: [CustomFieldValueDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomFieldValueDto)
  customFieldValues?: CustomFieldValueDto[];

  /** Rejected by the service if present. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  uhid?: string;

  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  registeredBranchId?: string;

  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  tenantId?: string;
}

export class UhidStartNumberDto {
  @ApiProperty({ example: 100, description: 'Next UHID running number to issue (raise-only)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startNumber!: number;

  @ApiProperty({ example: 'Skip imported block' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
