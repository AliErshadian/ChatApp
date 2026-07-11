import { User } from '../../users/entities/user.entity';

export type AuthenticatedUser = User & { sessionId: string };
