import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Poll } from './poll.entity';
import { PollVote } from './poll-vote.entity';

@Entity('poll_options')
export class PollOption {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'poll_id' })
  pollId!: string;

  @ManyToOne(() => Poll, (poll) => poll.options, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'poll_id' })
  poll!: Poll;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @OneToMany(() => PollVote, (vote) => vote.option)
  votes!: PollVote[];
}
