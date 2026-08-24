import { UserRole } from '@prisma/client';

export const isTasterRole = (role: UserRole) => role === UserRole.TASTER;

export const getSignedInHomePath = (role: UserRole) =>
  role === UserRole.PLATFORM_ADMIN ? '/platform' : isTasterRole(role) ? '/visits/new' : '/';
