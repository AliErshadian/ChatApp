import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Story } from './story.entity';

@Entity('story_views')
export class StoryView {
  @PrimaryColumn({ name: 'story_id' })
  storyId!: string;

  @PrimaryColumn({ name: 'viewer_id' })
  viewerId!: string;

  @ManyToOne(() => Story, (story) => story.views, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'story_id' })
  story!: Story;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'viewer_id' })
  viewer!: User;

  @CreateDateColumn({ name: 'viewed_at' })
  viewedAt!: Date;
}
