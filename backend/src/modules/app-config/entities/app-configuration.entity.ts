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

  @Column({ name: 'screen_sharing_enabled', default: false })
  screenSharingEnabled!: boolean;

  @Column({ name: 'screen_sharing_direct_enabled', default: true })
  screenSharingDirectEnabled!: boolean;

  @Column({ name: 'screen_sharing_groups_enabled', default: true })
  screenSharingGroupsEnabled!: boolean;

  @Column({ name: 'screen_max_resolution', default: '1080p' })
  screenMaxResolution!: string;

  @Column({ name: 'screen_max_fps', default: 15 })
  screenMaxFps!: number;

  @Column({ name: 'screen_max_concurrent_sessions', default: 50 })
  screenMaxConcurrentSessions!: number;

  @Column({ name: 'screen_bandwidth_limit_kbps', type: 'int', nullable: true })
  screenBandwidthLimitKbps!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
