import { storage } from './config';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

async function uploadFromUri(path: string, uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob);
  return await getDownloadURL(storageRef);
}

export async function uploadUserAvatar(userId: string, uri: string): Promise<string> {
  const ext = uri.split('.').pop() || 'jpg';
  const path = `images/users/${userId}/avatar.${ext}`;
  return await uploadFromUri(path, uri);
}


