import { IsUUID } from 'class-validator';

export class AddContactDto {
  @IsUUID()
  userId!: string;
}
