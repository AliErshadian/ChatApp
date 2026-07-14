import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Poll } from './poll.entity';
import { PollOption } from './poll-option.entity';
import { User } from '../../users/entities/user.entity';

@Entity('poll_votes')
@Unique(['pollId', 'userId', 'optionId'])
export class PollVote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'poll_id' })
  pollId!: string;

  @ManyToOne(() => Poll, (poll) => poll.votes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'poll_id' })
  poll!: Poll;

  @Column({ name: 'option_id' })
  optionId!: string;

  @ManyToOne(() => PollOption, (option) => option.votes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'option_id' })
  option!: PollOption;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
