import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../modules/users/entities/user.entity';
import { Conversation } from '../../modules/conversations/entities/conversation.entity';
import { Message } from '../../modules/messages/entities/message.entity';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'original_name' })
  originalName!: string;

  @Column({ name: 'file_name' })
  fileName!: string;

  @Column({ length: 128 })
  bucket!: string;

  @Column({ name: 'object_key', type: 'text' })
  objectKey!: string;

  @Column({ name: 'mime_type', length: 128 })
  mimeType!: string;

  @Column({ length: 32 })
  extension!: string;

  @Column({ type: 'bigint' })
  size!: string;

  @Column({ length: 64 })
  checksum!: string;

  @Column({ type: 'text' })
  url!: string;

  @Column({ name: 'uploaded_by' })
  uploadedBy!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uploaded_by' })
  uploader!: User;

  @Column({ name: 'conversation_id', nullable: true })
  conversationId?: string;

  @ManyToOne(() => Conversation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation;

  @Column({ name: 'message_id', nullable: true })
  messageId?: string;

  @ManyToOne(() => Message, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'message_id' })
  message?: Message;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
