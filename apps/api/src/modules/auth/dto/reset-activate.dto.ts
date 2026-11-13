import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Opaque action token from the email link fragment' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  newPassword!: string;
}

export class ActivateDto {
  @ApiProperty({ description: 'Opaque activation token from the email link fragment' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  newPassword!: string;
}
