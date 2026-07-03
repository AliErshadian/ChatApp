import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Message } from './message.entity';
import { User } from '../../users/entities/user.entity';

@Entity('message_user_hidden')
@Unique(['messageId', 'userId'])
export class MessageUserHidden {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'message_id' })
  messageId!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message!: Message;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @CreateDateColumn({ name: 'hidden_at' })
  hiddenAt!: Date;
}
