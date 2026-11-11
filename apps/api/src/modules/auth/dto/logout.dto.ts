import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LogoutDto {
  @ApiProperty({ description: 'Opaque refresh token to revoke' })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
