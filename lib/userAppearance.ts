export function parseDarkModePreference(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('darkMode' in value) || typeof value.darkMode !== 'boolean') {
    throw new Error('Choose whether Dark mode is on or off.');
  }
  return value.darkMode;
}

type AppearanceStore = {
  user: {
    update(args: { where: { id: string }; data: { darkMode: boolean }; select: { darkMode: true } }): Promise<{ darkMode: boolean }>;
  };
};

// Identity comes only from the authenticated session, never the request body.
export function saveUserAppearance(store: AppearanceStore, userId: string, darkMode: boolean) {
  return store.user.update({ where: { id: userId }, data: { darkMode }, select: { darkMode: true } });
}
