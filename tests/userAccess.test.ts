import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole } from '@prisma/client';
import { getSignedInHomePath, isAdminRole, isTasterRole } from '../lib/userAccess';

test('tasters land on the restricted visit logger', () => {
  assert.equal(isTasterRole(UserRole.TASTER), true);
  assert.equal(getSignedInHomePath(UserRole.TASTER), '/visits/new');
});

test('admins and standard users keep the dashboard landing page', () => {
  assert.equal(isTasterRole(UserRole.ADMIN), false);
  assert.equal(isTasterRole(UserRole.USER), false);
  assert.equal(getSignedInHomePath(UserRole.ADMIN), '/');
  assert.equal(getSignedInHomePath(UserRole.USER), '/');
});

test('organization and platform admins can use organization administration workflows', () => {
  assert.equal(isAdminRole(UserRole.ADMIN), true);
  assert.equal(isAdminRole(UserRole.PLATFORM_ADMIN), true);
  assert.equal(isAdminRole(UserRole.USER), false);
  assert.equal(isAdminRole(UserRole.TASTER), false);
});
