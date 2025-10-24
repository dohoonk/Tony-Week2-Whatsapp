import 'dotenv/config';
export default {
  name: 'app',
  slug: 'app',
  version: '1.0.0',
  scheme: 'whatsappclone',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: process.env.EXPO_IOS_BUNDLE_ID || 'com.example.whatsappclone',
    infoPlist: {
      NSCameraUsageDescription: 'This app uses the camera to take photos and videos for messages and avatars.',
      NSPhotoLibraryUsageDescription: 'This app needs access to your photo library to select images to send.',
      NSPhotoLibraryAddUsageDescription: 'This app may save images to your photo library when you download media.',
    },
  },
  android: {
    package: process.env.EXPO_ANDROID_PACKAGE || 'com.example.whatsappclone',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-notifications'],
  extra: {
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
    },
    eas: {
      projectId: '027d40ee-2af7-4453-842f-1eb0c7c96de7',
    },
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  },
};


