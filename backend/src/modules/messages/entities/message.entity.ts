import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { User } from '../../users/entities/user.entity';
import { MessageReadReceipt } from './message-read-receipt.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id' })
  conversationId!: string;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @Column({ name: 'sender_id' })
  senderId!: string;

  @ManyToOne(() => User, (u) => u.messages)
  @JoinColumn({ name: 'sender_id' })
  sender!: User;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'content_type', default: 'text/plain' })
  contentType!: string;

  @Column({ name: 'client_message_id', nullable: true })
  clientMessageId?: string;

  @Generated('increment')
  @Column({ type: 'bigint' })
  sequence!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'edited_at', nullable: true })
  editedAt?: Date;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;

  @OneToMany(() => MessageReadReceipt, (r) => r.message)
  readReceipts!: MessageReadReceipt[];
}
