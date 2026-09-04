import { UserRole } from '@prisma/client';

export const isTasterRole = (role: UserRole) => role === UserRole.TASTER;

export const isAdminRole = (role: UserRole) =>
  role === UserRole.ADMIN || role === UserRole.PLATFORM_ADMIN;

export const getSignedInHomePath = (role: UserRole) =>
  role === UserRole.PLATFORM_ADMIN ? '/platform' : isTasterRole(role) ? '/visits/new' : '/';
