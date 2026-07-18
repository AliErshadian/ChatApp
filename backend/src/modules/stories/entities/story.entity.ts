import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Attachment } from '../../../storage/entities/attachment.entity';
import { StoryView } from './story-view.entity';
import { StoryLike } from './story-like.entity';

@Entity('stories')
export class Story {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'author_id' })
  authorId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author!: User;

  @Column({ name: 'attachment_id' })
  attachmentId!: string;

  @ManyToOne(() => Attachment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attachment_id' })
  attachment!: Attachment;

  @Column({ type: 'text', nullable: true })
  caption?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @OneToMany(() => StoryView, (view) => view.story)
  views!: StoryView[];

  @OneToMany(() => StoryLike, (like) => like.story)
  likes!: StoryLike[];
}
