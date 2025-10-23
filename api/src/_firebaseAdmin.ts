import admin from 'firebase-admin';

let app: admin.app.App | null = null;

export function getAdminApp(): admin.app.App {
  if (app) return app;
  const projectId = process.env.FIREBASE_PROJECT_ID as string;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL as string;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY as string)?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase Admin credentials');
  }
  app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
  return app;
}

export function getAdminDb() {
  return getAdminApp().firestore();
}

export async function verifyIdToken(idToken: string) {
  const auth = getAdminApp().auth();
  return await auth.verifyIdToken(idToken);
}


