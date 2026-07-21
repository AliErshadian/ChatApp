import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Conversation, ConversationType } from '../../conversations/entities/conversation.entity';
import { User } from '../../users/entities/user.entity';
import { ScreenShareParticipant } from './screen-share-participant.entity';

export type ScreenShareSessionStatus = 'active' | 'ended';
export type ScreenShareSource = 'screen' | 'window' | 'monitor' | 'application';

@Entity('screen_share_sessions')
export class ScreenShareSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id' })
  conversationId!: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @Column({ name: 'conversation_type', type: 'enum', enum: ConversationType })
  conversationType!: ConversationType;

  @Column({ name: 'host_user_id' })
  hostUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'host_user_id' })
  host!: User;

  @Column({
    type: 'enum',
    enum: ['active', 'ended'],
    enumName: 'screen_share_session_status',
    default: 'active',
  })
  status!: ScreenShareSessionStatus;

  @Column({
    name: 'screen_source',
    type: 'enum',
    enum: ['screen', 'window', 'monitor', 'application'],
    enumName: 'screen_share_source',
    nullable: true,
  })
  screenSource!: ScreenShareSource | null;

  @Column({ name: 'quality_hint', type: 'varchar', length: 32, nullable: true })
  qualityHint!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ScreenShareParticipant, (p) => p.session)
  participants!: ScreenShareParticipant[];
}
