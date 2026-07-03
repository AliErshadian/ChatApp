import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Message } from './message.entity';
import { User } from '../../users/entities/user.entity';

@Entity('message_read_receipts')
export class MessageReadReceipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'message_id' })
  messageId!: string;

  @ManyToOne(() => Message, (m) => m.readReceipts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message!: Message;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @CreateDateColumn({ name: 'read_at' })
  readAt!: Date;
}
