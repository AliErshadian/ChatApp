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

  @Column({ name: 'content_type', length: 128, default: 'text/plain' })
  contentType!: string;

  @Column({ name: 'file_name', nullable: true })
  fileName?: string;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize?: string;

  @Column({ type: 'text', nullable: true })
  caption?: string;

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

  @Column({ name: 'reply_to_message_id', type: 'uuid', nullable: true })
  replyToMessageId?: string;

  @ManyToOne(() => Message, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reply_to_message_id' })
  replyTo?: Message;

  @OneToMany(() => MessageReadReceipt, (r) => r.message)
  readReceipts!: MessageReadReceipt[];
}
