// These values are deliberately limited to public browser configuration.
// Server credentials are never imported by the web application.
export const publicConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  // Use the hosted API when the frontend is opened outside localhost. A
  // local override can still be supplied through NEXT_PUBLIC_API_BASE_URL.
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://nabd-api-production.up.railway.app',
};
