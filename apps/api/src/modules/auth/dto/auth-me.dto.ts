import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthMeBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isMain!: boolean;
}

export class AuthMeModuleDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class AuthMeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['HOSPITAL', 'HQ'] })
  kind!: 'HOSPITAL' | 'HQ';

  @ApiPropertyOptional({ nullable: true, type: String })
  hospitalName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  activeBranchId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  activeBranchName!: string | null;

  @ApiProperty({ type: [String] })
  roleCodes!: string[];

  @ApiProperty()
  mustChangePassword!: boolean;

  @ApiProperty({ type: [AuthMeBranchDto] })
  branches!: AuthMeBranchDto[];

  @ApiProperty({ type: [AuthMeModuleDto] })
  enabledModules!: AuthMeModuleDto[];

  @ApiProperty({
    description:
      'Hospital: true when the user holds an active hospital-wide role (may use the branch switcher). HQ: false.',
  })
  canSwitchBranch!: boolean;

  @ApiProperty({
    type: [String],
    description:
      'Hospital: permission codes allowed on the active branch (AccessService.can without module gate). HQ: [].',
  })
  permissions!: string[];
}
