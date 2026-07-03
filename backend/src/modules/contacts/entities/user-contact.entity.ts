import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_contacts')
@Unique(['userId', 'contactUserId'])
export class UserContact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'contact_user_id' })
  contactUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_user_id' })
  contact!: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
