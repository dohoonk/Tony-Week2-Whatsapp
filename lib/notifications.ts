import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

const isExpoGo = Constants?.appOwnership === 'expo';

if (isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // Prefer banner/list flags (Expo SDK >= 51); keep sound on
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


