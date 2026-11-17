import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SwitchBranchDto {
  @ApiProperty({ description: 'Branch to make active (same hospital, active)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  branchId!: string;

  @ApiProperty({ description: 'The caller’s current refresh token (rotated by the switch)' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refreshToken!: string;
}

export class SwitchableBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isMain!: boolean;

  @ApiProperty({ description: 'True for the branch of the token used on this call' })
  isCurrent!: boolean;
}
