import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  displayName!: string;
}
