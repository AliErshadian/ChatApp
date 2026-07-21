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
import { User } from '../../users/entities/user.entity';
import { ConversationMember } from './conversation-member.entity';
import { Message } from '../../messages/entities/message.entity';

export enum ConversationType {
  DIRECT = 'direct',
  CHANNEL = 'channel',
  GROUP = 'group',
}

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: ConversationType })
  type!: ConversationType;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  @Column({ name: 'created_by' })
  createdBy!: string;

  @Column({ name: 'pending_owner_id', type: 'uuid', nullable: true })
  pendingOwnerId?: string | null;

  @Column({ name: 'is_public', default: false })
  isPublic!: boolean;

  @Column({ name: 'screen_sharing_allowed', default: true })
  screenSharingAllowed!: boolean;

  @Column({ name: 'screen_allow_multiple_presenters', default: false })
  screenAllowMultiplePresenters!: boolean;

  @Column({ name: 'screen_max_concurrent_shares', default: 1 })
  screenMaxConcurrentShares!: number;

  @Column({ name: 'screen_max_participants', default: 8 })
  screenMaxParticipants!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator!: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ConversationMember, (m) => m.conversation)
  members!: ConversationMember[];

  @OneToMany(() => Message, (m) => m.conversation)
  messages!: Message[];
}
