import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LogoutDto {
  @ApiProperty({
    description:
      'Opaque refresh token to revoke (staff or patient logout; possession alone is enough — no Bearer)',
  })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
