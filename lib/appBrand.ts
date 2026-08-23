import type { Metadata } from 'next';

export const APP_NAME = 'Neat';
export const APP_COMPANY = 'Echo Spirits';
export const APP_DESCRIPTION = 'Sales intelligence and field CRM for Echo Spirits.';

export const buildPageTitle = (pageName?: string | null) =>
  pageName?.trim() ? `${pageName.trim()} | ${APP_NAME}` : APP_NAME;

export const buildPageMetadata = (pageName: string): Metadata => ({
  title: { absolute: buildPageTitle(pageName) },
});
