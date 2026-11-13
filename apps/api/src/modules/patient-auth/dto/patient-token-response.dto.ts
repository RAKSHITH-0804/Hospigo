import { ApiProperty } from '@nestjs/swagger';

/** Patient OTP token pair — no password / mustChangePassword. */
export class PatientTokenResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ description: 'Access token lifetime in seconds' })
  expiresIn!: number;
}
