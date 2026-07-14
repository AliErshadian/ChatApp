import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Message } from './message.entity';
import { User } from '../../users/entities/user.entity';
import { PollOption } from './poll-option.entity';
import { PollVote } from './poll-vote.entity';

@Entity('polls')
export class Poll {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'message_id' })
  messageId!: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message!: Message;

  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'boolean', default: false })
  anonymous!: boolean;

  @Column({ name: 'allows_multiple', type: 'boolean', default: false })
  allowsMultiple!: boolean;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy?: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'closed_by' })
  closedByUser?: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => PollOption, (option) => option.poll)
  options!: PollOption[];

  @OneToMany(() => PollVote, (vote) => vote.poll)
  votes!: PollVote[];
}
