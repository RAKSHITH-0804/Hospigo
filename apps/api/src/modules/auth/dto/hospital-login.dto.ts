import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class HospitalLoginDto {
  @ApiProperty({ example: 'demo-north-main' })
  @IsString()
  @MinLength(1)
  accessCode!: string;

  @ApiProperty({ example: 'staff@demo-north.example.test' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'your-password-here' })
  @IsString()
  @MinLength(1)
  password!: string;
}
