import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { User } from '../../users/entities/user.entity';
import type { CallEndedPayload, CallMediaType } from '../call.types';

@Entity('call_records')
export class CallRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'call_id', type: 'uuid', unique: true })
  callId!: string;

  @Column({ name: 'conversation_id' })
  conversationId!: string;

  @Column({ name: 'caller_id' })
  callerId!: string;

  @Column({ name: 'callee_id' })
  calleeId!: string;

  @Column({ name: 'end_reason', type: 'text' })
  endReason!: CallEndedPayload['reason'];

  @Column({ name: 'ended_by', type: 'uuid', nullable: true })
  endedBy!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt!: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz' })
  endedAt!: Date;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds!: number | null;

  @Column({ name: 'media_type', type: 'text', default: 'audio' })
  mediaType!: CallMediaType;

  @Column({ name: 'callee_seen_at', type: 'timestamptz', nullable: true })
  calleeSeenAt!: Date | null;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caller_id' })
  caller!: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callee_id' })
  callee!: User;
}
