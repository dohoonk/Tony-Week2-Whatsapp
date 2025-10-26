// Safe haptics wrapper. Works even if expo-haptics isn't installed.
export async function impactLight() {
  try {
    const H = await import('expo-haptics');
    // @ts-ignore
    await H.impactAsync?.(H.ImpactFeedbackStyle?.Light ?? 0);
  } catch {}
}

export async function selection() {
  try {
    const H = await import('expo-haptics');
    // @ts-ignore
    await H.selectionAsync?.();
  } catch {}
}

export async function notificationSuccess() {
  try {
    const H = await import('expo-haptics');
    // @ts-ignore
    await H.notificationAsync?.(H.NotificationFeedbackType?.Success ?? 1);
  } catch {}
}


