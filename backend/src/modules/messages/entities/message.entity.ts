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
import { MessageMention } from './message-mention.entity';

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

  @Column({ name: 'search_vector', type: 'tsvector', nullable: true, select: false })
  searchVector?: string;

  @Column({ name: 'reply_to_message_id', type: 'uuid', nullable: true })
  replyToMessageId?: string;

  @ManyToOne(() => Message, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reply_to_message_id' })
  replyTo?: Message;

  @Column({ name: 'thread_root_id', type: 'uuid', nullable: true })
  threadRootId?: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'thread_root_id' })
  threadRoot?: Message;

  @Column({ name: 'reply_count', type: 'int', default: 0 })
  replyCount!: number;

  @Column({ name: 'latest_reply_at', type: 'timestamptz', nullable: true })
  latestReplyAt?: Date;

  @Column({ name: 'forwarded_from_message_id', type: 'uuid', nullable: true })
  forwardedFromMessageId?: string;

  @ManyToOne(() => Message, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'forwarded_from_message_id' })
  forwardedFrom?: Message;

  @Column({ name: 'original_sender_id', type: 'uuid', nullable: true })
  originalSenderId?: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'original_sender_id' })
  originalSender?: User;

  @Column({ name: 'story_id', type: 'uuid', nullable: true })
  storyId?: string;

  @OneToMany(() => MessageReadReceipt, (r) => r.message)
  readReceipts!: MessageReadReceipt[];

  @OneToMany(() => MessageMention, (mention) => mention.message)
  mentions!: MessageMention[];
}
