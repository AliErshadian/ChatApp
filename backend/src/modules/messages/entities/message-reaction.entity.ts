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

@Entity('message_reactions')
export class MessageReaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'message_id' })
  messageId!: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message!: Message;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 32 })
  emoji!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
