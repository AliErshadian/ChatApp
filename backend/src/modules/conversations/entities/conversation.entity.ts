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

  @Column({ name: 'created_by' })
  createdBy!: string;

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
