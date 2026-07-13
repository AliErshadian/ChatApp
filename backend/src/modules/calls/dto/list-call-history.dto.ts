import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { CallHistoryCategory } from '../call-history.util';

const CALL_HISTORY_FILTERS = [
  'all',
  'incoming',
  'outgoing',
  'missed',
  'cancelled',
  'not_answered',
] as const;

export class ListCallHistoryDto {
  @IsOptional()
  @IsIn(CALL_HISTORY_FILTERS)
  filter?: CallHistoryCategory | 'all';

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
