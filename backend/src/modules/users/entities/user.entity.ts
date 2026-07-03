import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ConversationMember } from '../../conversations/entities/conversation-member.entity';
import { Message } from '../../messages/entities/message.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash!: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ConversationMember, (m) => m.user)
  memberships!: ConversationMember[];

  @OneToMany(() => Message, (m) => m.sender)
  messages!: Message[];

  @OneToMany(() => RefreshToken, (t) => t.user)
  refreshTokens!: RefreshToken[];
}
