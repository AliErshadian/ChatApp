import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('app_configurations')
export class AppConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'voice_calls_enabled', default: true })
  voiceCallsEnabled!: boolean;

  @Column({ name: 'video_calls_enabled', default: true })
  videoCallsEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
