// These values are deliberately limited to public browser configuration.
// Server credentials are never imported by the web application.
export const publicConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8787',
};
