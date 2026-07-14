import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Note } from './note.entity';

@Entity('note_revisions')
export class NoteRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'note_id' })
  noteId!: string;

  @ManyToOne(() => Note, (note) => note.revisions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_id' })
  note!: Note;

  @Column({ name: 'edited_by' })
  editedBy!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'edited_by' })
  editor!: User;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ name: 'changed_fields', type: 'text', array: true, default: '{}' })
  changedFields!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
