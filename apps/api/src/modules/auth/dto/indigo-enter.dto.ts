import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** The hospital an Indigo person wants to work in. Nothing else comes from the caller. */
export class IndigoEnterDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  hospitalId!: string;
}
