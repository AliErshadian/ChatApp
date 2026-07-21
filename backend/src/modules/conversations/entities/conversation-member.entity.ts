import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from '../../users/entities/user.entity';

export enum MemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
  MEMBER = 'member',
}

@Entity('conversation_members')
export class ConversationMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id' })
  conversationId!: string;

  @ManyToOne(() => Conversation, (c) => c.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, (u) => u.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: MemberRole, default: MemberRole.MEMBER })
  role!: MemberRole;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt!: Date;

  @Column({ name: 'last_read_at', nullable: true })
  lastReadAt?: Date;

  @Column({ name: 'pinned_at', type: 'timestamptz', nullable: true })
  pinnedAt?: Date | null;
}
