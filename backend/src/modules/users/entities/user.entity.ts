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
import type { AuthenticationProviderId } from '../../auth/providers/auth-provider.types';

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

  @Column({ name: 'password_hash', select: false, nullable: true, type: 'varchar' })
  passwordHash?: string | null;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'is_admin', default: false })
  isAdmin!: boolean;

  @Column({
    name: 'authentication_provider',
    type: 'enum',
    enum: ['local', 'active_directory'],
    enumName: 'authentication_provider',
    default: 'local',
  })
  authenticationProvider!: AuthenticationProviderId;

  @Column({ name: 'ad_guid', nullable: true, type: 'varchar' })
  adGuid?: string | null;

  @Column({ name: 'ad_sid', nullable: true, type: 'varchar' })
  adSid?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  department?: string | null;

  @Column({ name: 'job_title', nullable: true, type: 'varchar' })
  jobTitle?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  company?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  phone?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  manager?: string | null;

  @Column({ name: 'last_directory_sync', type: 'timestamptz', nullable: true })
  lastDirectorySync?: Date | null;

  @Column({ name: 'directory_enabled', default: true })
  directoryEnabled!: boolean;

  @Column({ name: 'directory_groups', type: 'jsonb', default: () => "'[]'" })
  directoryGroups!: string[];

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
