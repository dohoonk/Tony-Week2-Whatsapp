import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './navigation/AppNavigator';
import './firebase/config';
import { onAuthStateChanged } from './firebase/authService';
import LoginScreen from './screens/Auth/LoginScreen';
import { View, ActivityIndicator } from 'react-native';
import OnboardingScreen from './screens/Auth/OnboardingScreen';
import { getUserProfile } from './firebase/userService';
import { registerForPushNotificationsAsync } from './lib/notifications';
import { doc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from './firebase/config';

export default function App() {
  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<any>(null);
  const [needsOnboarding, setNeedsOnboarding] = React.useState(false);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(async (u) => {
      setUser(u);
      if (u?.uid) {
        const profile = await getUserProfile(u.uid);
        setNeedsOnboarding(!profile);
        const token = await registerForPushNotificationsAsync();
        if (token) {
          const userRef = doc(db, 'users', u.uid);
          await setDoc(userRef, { pushTokens: arrayUnion(token) }, { merge: true });
        }
      } else {
        setNeedsOnboarding(false);
      }
      setReady(true);
    });
    return () => unsub();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {!user ? (
        <LoginScreen />
      ) : needsOnboarding ? (
        <OnboardingScreen onDone={() => setNeedsOnboarding(false)} />
      ) : (
        <AppNavigator />
      )}
    </NavigationContainer>
  );
}
