import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'Opaque refresh token from login' })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
