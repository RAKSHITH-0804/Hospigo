import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @MinLength(1)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(1)
  code!: string;
}
