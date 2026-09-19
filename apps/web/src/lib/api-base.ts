/**
 * Browser calls same-origin `/api` (Next.js rewrite → Nest on :4010).
 * That keeps login and SAP calls working when the UI is opened on a LAN IP
 * such as http://192.168.x.x:3000 instead of localhost.
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    return '/api';
  }
  const env = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  return env || 'http://127.0.0.1:4010/api';
}
