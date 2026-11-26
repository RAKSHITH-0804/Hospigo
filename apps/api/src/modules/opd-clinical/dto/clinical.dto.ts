import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OPD_CLINICAL_CONFIG as C } from '../opd-clinical.config';

/**
 * The consultation note. Nothing else can be sent: no status, no doctor, no branch, no visit
 * (they come from the URL, the token and the database). Unknown fields are rejected.
 * PUT replaces all four fields: a field left out is cleared.
 */
export class SaveNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(C.noteTextMaxLength)
  complaints?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(C.noteTextMaxLength)
  diagnosis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(C.noteTextMaxLength)
  advice?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, not before the visit day' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  followUpDate?: string;
}

export class AddendumDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(C.addendumTextMaxLength)
  text!: string;

  @ApiProperty({ description: 'Why the completed note is being corrected' })
  @IsString()
  @MinLength(1)
  @MaxLength(C.addendumReasonMaxLength)
  reason!: string;
}

/** One prescription row: a listed medicine (medicineId) OR free text (medicineName), not both. */
export class PrescriptionItemDto {
  @ApiPropertyOptional({ description: 'Medicine from the hospital list' })
  @ValidateIf((o: PrescriptionItemDto) => o.medicineId !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(C.idMaxLength)
  medicineId?: string;

  @ApiPropertyOptional({ description: 'Free text; the row is flagged "unlisted"' })
  @ValidateIf((o: PrescriptionItemDto) => o.medicineName !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(C.medicineNameMaxLength)
  medicineName?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(C.doseMaxLength)
  dose!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(C.frequencyMaxLength)
  frequency!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(C.durationMaxLength)
  duration!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(C.instructionsMaxLength)
  instructions?: string;
}

/** Replaces the whole prescription of the draft note (an empty list clears it). */
export class SavePrescriptionDto {
  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray()
  @ArrayMaxSize(C.maxPrescriptionItems)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];
}

/** One vitals reading: the field by code and its value (a number or text, by the field kind). */
export class VitalsReadingDto {
  @ApiProperty({ description: 'Vitals field code from GET /opd/vitals-fields' })
  @IsString()
  @MinLength(1)
  @MaxLength(C.vitalsCodeMaxLength)
  fieldCode!: string;

  @ApiProperty({ description: 'A number for number fields, text for text fields' })
  @IsDefined()
  value!: number | string;

  @ApiPropertyOptional({ description: 'Required when this corrects an earlier reading' })
  @IsOptional()
  @IsString()
  @MaxLength(C.vitalsReasonMaxLength)
  correctionReason?: string;
}

export class RecordVitalsDto {
  @ApiProperty({ type: [VitalsReadingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(C.maxVitalsReadings)
  @ValidateNested({ each: true })
  @Type(() => VitalsReadingDto)
  readings!: VitalsReadingDto[];
}

/**
 * A change of a COMPLETED consultation (Step 2.1b): the reason is required, and every other field
 * is optional (only what is sent changes). The result is saved as a new version; the original stays.
 */
export class AmendConsultationDto {
  @ApiProperty({ description: 'Why the note is changed (3 to 500 characters)' })
  @IsString()
  @MinLength(C.amendReasonMinLength)
  @MaxLength(C.amendReasonMaxLength)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(C.noteTextMaxLength)
  complaints?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(C.noteTextMaxLength)
  diagnosis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(C.noteTextMaxLength)
  advice?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, or an empty text to clear' })
  @IsOptional()
  @IsString()
  followUpDate?: string;

  @ApiPropertyOptional({
    type: [PrescriptionItemDto],
    description: 'The whole prescription as it should be',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(C.maxPrescriptionItems)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  prescription?: PrescriptionItemDto[];
}
