export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export function formatTime(millis: number): string {
  if (!millis || millis < 0) return '0:00';
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatNumber(n: number, lang: 'am' | 'en'): string {
  if (lang === 'am') return toGeezNumeral(n);
  return String(n);
}

export function toGeezNumeral(n: number): string {
  const geezDigits = ['፩', '፪', '፫', '፬', '፭', '፮', '፯', '፰', '፱', '፲'];
  return String(n).split('').map(d => geezDigits[parseInt(d)] || d).join('');
}