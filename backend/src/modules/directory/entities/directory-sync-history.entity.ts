import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DirectorySyncStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed';

@Entity('directory_sync_history')
export class DirectorySyncHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'triggered_by', default: 'manual' })
  triggeredBy!: string;

  @Column({ name: 'triggered_by_user_id', type: 'uuid', nullable: true })
  triggeredByUserId?: string | null;

  @Column({
    type: 'enum',
    enum: ['pending', 'running', 'success', 'partial', 'failed'],
    enumName: 'directory_sync_status',
    default: 'pending',
  })
  status!: DirectorySyncStatus;

  @Column({ name: 'users_examined', default: 0 })
  usersExamined!: number;

  @Column({ name: 'users_updated', default: 0 })
  usersUpdated!: number;

  @Column({ name: 'users_created', default: 0 })
  usersCreated!: number;

  @Column({ name: 'users_disabled', default: 0 })
  usersDisabled!: number;

  @Column({ name: 'groups_examined', default: 0 })
  groupsExamined!: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  details!: Record<string, unknown>;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;
}
