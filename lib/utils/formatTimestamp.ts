export function formatLastMessageTime(epochMs?: number): string {
  if (!epochMs) return '';
  const d = new Date(epochMs);
  const now = new Date();

  const isSameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isSameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Yesterday?
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate();
  if (isYesterday) return 'Yesterday';

  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}


