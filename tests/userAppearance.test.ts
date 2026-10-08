import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDarkModePreference, saveUserAppearance } from '../lib/userAppearance';

test('appearance requires an explicit boolean; malformed values cannot change the preference', () => {
  for (const input of [null, undefined, {}, 'dark', { darkMode: 'false' }, { darkMode: 1 }, { darkMode: null }]) {
    assert.throws(() => parseDarkModePreference(input));
  }
  assert.equal(parseDarkModePreference({ darkMode: false }), false);
  assert.equal(parseDarkModePreference({ darkMode: true }), true);
});

test('appearance writes only the signed-in user and preserves unrelated profile fields', async () => {
  const users = new Map([['signed-in', { darkMode: false, phone: '123' }], ['other-user', { darkMode: false, phone: '456' }]]);
  const store = { user: { update: async ({ where, data }: { where: { id: string }; data: { darkMode: boolean } }) => {
    const user = users.get(where.id)!;
    Object.assign(user, data);
    return { darkMode: user.darkMode };
  } } };
  const request = { darkMode: true, userId: 'other-user', phone: 'changed' };
  assert.deepEqual(await saveUserAppearance(store, 'signed-in', parseDarkModePreference(request)), { darkMode: true });
  assert.deepEqual(users.get('signed-in'), { darkMode: true, phone: '123' });
  assert.deepEqual(users.get('other-user'), { darkMode: false, phone: '456' });
  assert.deepEqual(await saveUserAppearance(store, 'signed-in', true), { darkMode: true });
  assert.deepEqual(await saveUserAppearance(store, 'signed-in', false), { darkMode: false });
});
