import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

const isExpoGo = Constants?.appOwnership === 'expo';

if (isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // Prefer banner/list flags (Expo SDK >= 51); keep sound on
      shouldShowAlert: true as any, // legacy-safe for Expo Go and older runtimes
      shouldShowBanner: true as any,
      shouldShowList: false as any,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }) as any,
  });
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!isExpoGo) return null;
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return null;
  }
  try {
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? undefined;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    return token;
  } catch {
    return null;
  }
}

export async function showLocalNotification(title: string, body: string, data?: Record<string, any>) {
  if (!isExpoGo) return;
  try {
    // Ensure we have permission (Expo Go sometimes loses state)
    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      if (__DEV__) {
        try { console.log('showLocalNotification skipped: permission not granted'); } catch {}
      }
      return;
    }
    // dev log removed
    // Try immediate present first
    try {
      // presentNotificationAsync exists in SDK 51+; guard in case of older runtime
      const anyNotif: any = Notifications as any;
      if (typeof anyNotif.presentNotificationAsync === 'function') {
        await anyNotif.presentNotificationAsync({ title, body, data: data ?? {}, sound: true });
        return;
      }
    } catch {}
    // Fallback: schedule immediate
    // dev log removed
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data ?? {},
      },
      trigger: null,
    });
  } catch {
    // ignore
  }
}


