import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @MinLength(1)
  phone!: string;
}
