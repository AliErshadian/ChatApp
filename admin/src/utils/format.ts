export function formatDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}
