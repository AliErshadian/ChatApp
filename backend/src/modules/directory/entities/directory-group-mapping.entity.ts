import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DirectoryChatRole = 'system_admin' | 'none';

@Entity('directory_group_mappings')
export class DirectoryGroupMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ad_group_dn', type: 'varchar', length: 1024, unique: true })
  adGroupDn!: string;

  @Column({ name: 'ad_group_name', type: 'varchar', length: 256 })
  adGroupName!: string;

  @Column({
    name: 'chat_role',
    type: 'enum',
    enum: ['system_admin', 'none'],
    enumName: 'directory_chat_role',
    default: 'none',
  })
  chatRole!: DirectoryChatRole;

  @Column({ name: 'allow_login', default: true })
  allowLogin!: boolean;

  @Column({ name: 'is_approved_security_group', default: false })
  isApprovedSecurityGroup!: boolean;

  @Column({ default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
