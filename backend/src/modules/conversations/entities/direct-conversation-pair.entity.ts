import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('direct_conversation_pairs')
export class DirectConversationPair {
  @PrimaryColumn({ name: 'conversation_id' })
  conversationId!: string;

  @Column({ name: 'user_a' })
  userA!: string;

  @Column({ name: 'user_b' })
  userB!: string;
}
