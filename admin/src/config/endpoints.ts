const DEFAULT_API = 'http://localhost:3000/api/v1';

export function getApiBase(): string {
  return import.meta.env.VITE_API_URL ?? DEFAULT_API;
}
