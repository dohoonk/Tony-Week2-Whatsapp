import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert, TouchableOpacity } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri } from 'expo-auth-session';
import { auth, db } from '../../firebase/config';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { signInWithEmailAndPassword } from '../../firebase/authService';
import { doc, setDoc } from 'firebase/firestore';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  WebBrowser.maybeCompleteAuthSession();
  const proxyRedirectUri = 'https://auth.expo.io/@tonydhk/app';
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID as string,
    redirectUri: proxyRedirectUri,
    scopes: ['openid', 'profile', 'email'],
  } as any);

  const onLogin = async () => {
    try {
      setLoading(true);
      await signInWithEmailAndPassword(email.trim(), password);
      const uid = auth.currentUser?.uid;
      if (uid) {
        const now = Date.now();
        await Promise.all([
          setDoc(doc(db, 'presence', uid), { state: 'online', online: true, lastChanged: now }, { merge: true }),
          setDoc(doc(db, 'users', uid), { status: 'online', online: true, lastSeen: now, updatedAt: now }, { merge: true }),
        ]);
      }
    } catch (e: any) {
      Alert.alert('Login failed', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    try {
      setGoogleLoading(true);
      console.log('Google Web Client ID present:', !!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
      console.log('Google Web Client ID value:', process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
      console.log('Auth redirectUri forced:', proxyRedirectUri);
      const res = await promptAsync({ useProxy: true } as any);
      const idToken = (res as any)?.params?.id_token as string | undefined;
      if (!idToken) throw new Error('Google sign-in cancelled or failed');
      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      const uid = auth.currentUser?.uid;
      if (uid) {
        const now = Date.now();
        await Promise.all([
          setDoc(doc(db, 'presence', uid), { state: 'online', online: true, lastChanged: now }, { merge: true }),
          setDoc(doc(db, 'users', uid), { status: 'online', online: true, lastSeen: now, updatedAt: now }, { merge: true }),
        ]);
      }
    } catch (e: any) {
      Alert.alert('Google Sign-in failed', e?.message ?? 'Unknown error');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', marginBottom: 24 }}>
        <Text style={{ fontSize: 32, fontWeight: '800' }}>TripMate</Text>
        <Text style={{ color: '#6B7280', marginTop: 4 }}>Planning made easy with AI</Text>
      </View>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 12 }}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 16 }}
      />
      <Button title={loading ? 'Signing in...' : 'Sign In'} onPress={onLogin} disabled={loading} />
      <View style={{ height: 12 }} />
      <TouchableOpacity onPress={onGoogle} disabled={googleLoading} style={{ alignSelf: 'center' }}>
        <Text style={{ color: '#007AFF' }}>{googleLoading ? 'Signing in with Google…' : 'Sign in with Google'}</Text>
      </TouchableOpacity>
    </View>
  );
}


