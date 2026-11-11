import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiPropertyOptional({
    description: 'Omitted when mustChangePassword is true (CHANGE_PASSWORD access only)',
  })
  refreshToken?: string;

  @ApiProperty({ description: 'Access token lifetime in seconds' })
  expiresIn!: number;

  @ApiProperty()
  mustChangePassword!: boolean;
}
