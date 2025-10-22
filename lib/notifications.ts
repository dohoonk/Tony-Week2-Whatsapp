import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // iOS 16+: use banner/list flags; keep alert for backward compat
    shouldShowBanner: true,
    shouldShowList: true,
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotificationsAsync(): Promise<string | null> {
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

export async function showLocalNotification(title: string, body: string, data?: Record<string, any>, imageUrl?: string | null) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data ?? {},
        // iOS inline image (shows in expanded list/detail)
        attachments: imageUrl ? [{ identifier: 'avatar', url: imageUrl }] : undefined,
      },
      trigger: null,
    });
  } catch {
    // ignore
  }
}


