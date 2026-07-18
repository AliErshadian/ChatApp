import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Story } from './story.entity';

@Entity('story_likes')
export class StoryLike {
  @PrimaryColumn({ name: 'story_id' })
  storyId!: string;

  @PrimaryColumn({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => Story, (story) => story.likes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'story_id' })
  story!: Story;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @CreateDateColumn({ name: 'liked_at' })
  likedAt!: Date;
}
