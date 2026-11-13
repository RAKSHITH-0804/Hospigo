import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  accessCode!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class HqForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ForgotPasswordAcceptedDto {
  @ApiProperty({ example: true })
  accepted!: true;
}
