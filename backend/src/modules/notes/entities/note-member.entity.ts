import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Note } from './note.entity';

export type NoteMemberRole = 'owner' | 'contributor' | 'reader';

@Entity('note_members')
export class NoteMember {
  @PrimaryColumn({ name: 'note_id' })
  noteId!: string;

  @PrimaryColumn({ name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: ['owner', 'contributor', 'reader'] })
  role!: NoteMemberRole;

  @Column({ name: 'invited_by', type: 'uuid', nullable: true })
  invitedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invited_by' })
  inviter?: User | null;

  @ManyToOne(() => Note, (note) => note.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_id' })
  note!: Note;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt!: Date;
}
