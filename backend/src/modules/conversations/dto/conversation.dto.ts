import { IsString, IsUUID, IsOptional, MinLength, MaxLength, IsIn } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUUID('4', { each: true })
  memberIds?: string[];
}

export class CreateDirectDto {
  @IsUUID()
  userId!: string;
}

export class AddMembersDto {
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class DeleteConversationDto {
  @IsIn(['me', 'everyone'])
  scope!: 'me' | 'everyone';
}

export class LeaveChannelDto {
  @IsOptional()
  @IsUUID()
  newOwnerId?: string;
}
