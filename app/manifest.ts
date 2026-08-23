import type { MetadataRoute } from 'next';
import { APP_DESCRIPTION, APP_NAME } from '../lib/appBrand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#2458ff',
  };
}
