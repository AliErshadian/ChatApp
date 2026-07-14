import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Message } from './message.entity';
import { User } from '../../users/entities/user.entity';

@Entity('message_thread_reads')
export class MessageThreadRead {
  @PrimaryColumn({ name: 'thread_root_id', type: 'uuid' })
  threadRootId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'thread_root_id' })
  threadRoot!: Message;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'last_read_at', type: 'timestamptz' })
  lastReadAt!: Date;
}
