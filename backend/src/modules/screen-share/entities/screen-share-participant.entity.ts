import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ScreenShareSession } from './screen-share-session.entity';

export type ScreenShareParticipantRole = 'presenter' | 'viewer';

@Entity('screen_share_participants')
export class ScreenShareParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id' })
  sessionId!: string;

  @ManyToOne(() => ScreenShareSession, (s) => s.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: ScreenShareSession;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'enum',
    enum: ['presenter', 'viewer'],
    enumName: 'screen_share_participant_role',
    default: 'viewer',
  })
  role!: ScreenShareParticipantRole;

  @Column({ name: 'connection_state', default: 'joining' })
  connectionState!: string;

  @Column({ name: 'joined_at', type: 'timestamptz' })
  joinedAt!: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt!: Date | null;
}
