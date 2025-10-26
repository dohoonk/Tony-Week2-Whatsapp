// Plain Node-style handler with inline Firebase Admin

let admin: any;
try { admin = require('firebase-admin'); } catch {}
let __adminApp: any = null;
function getAdminApp() {
  if (__adminApp) return __adminApp;
  if (!admin) throw new Error('firebase-admin not installed');
  const projectId = process.env.FIREBASE_PROJECT_ID as string;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL as string;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY as string;
  const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\n/g, '\n') : undefined;
  if (!projectId || !clientEmail || !privateKey) throw new Error('Missing Firebase Admin credentials');
  __adminApp = admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  return __adminApp;
}
function getAdminDb() { return getAdminApp().firestore(); }
async function verifyIdToken(idToken: string) { return await getAdminApp().auth().verifyIdToken(idToken); }

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const auth = req.headers?.authorization || '';
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) { res.status(401).json({ error: 'Missing Authorization header' }); return; }
    const decoded = await verifyIdToken(token);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { chatId, city, start, end } = body as { chatId: string; city: string; start: string; end: string };
    if (!chatId || !city || !start || !end) { res.status(400).json({ error: 'chatId, city, start, end are required' }); return; }

    const db = getAdminDb();
    const chatSnap = await db.collection('chats').doc(chatId).get();
    if (!chatSnap.exists) { res.status(404).json({ error: 'Chat not found' }); return; }
    const members: string[] = Array.isArray((chatSnap.data() as any)?.members) ? (chatSnap.data() as any).members : [];
    if (!members.includes(decoded.uid)) { res.status(403).json({ error: 'Forbidden' }); return; }

    const wxKey = process.env.WEATHERAPI_KEY as string | undefined;
    if (!wxKey) { res.status(200).json({ days: [], warning: 'Missing WEATHERAPI_KEY' }); return; }

    // Resolve city to lat/lon
    let resolved: { name: string; lat: number; lon: number } | null = null;
    try {
      const sUrl = `https://api.weatherapi.com/v1/search.json?key=${wxKey}&q=${encodeURIComponent(city)}`;
      const sResp = await fetch(sUrl);
      if (sResp.ok) {
        const arr: any[] = await sResp.json();
        if (Array.isArray(arr) && arr.length > 0) {
          const top = arr[0] as any;
          resolved = { name: String(top?.name || city), lat: Number(top?.lat || 0), lon: Number(top?.lon || 0) };
        }
      }
    } catch {}
    if (!resolved) { res.status(200).json({ days: [], warning: `City not found: ${city}` }); return; }

    const q = `${resolved.lat},${resolved.lon}`;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!isFinite(startMs) || !isFinite(endMs)) { res.status(400).json({ error: 'Invalid start/end' }); return; }

    const within14 = (startMs - Date.now())/(24*3600*1000) <= 14 && (endMs - Date.now())/(24*3600*1000) <= 14;
    const results: { date: string; lo: number; hi: number; cond: string; icon?: string }[] = [];
    if (within14) {
      const daysNeeded = Math.min(14, Math.max(1, Math.ceil((endMs - Date.now())/(24*3600*1000)) + 1));
      const url = `https://api.weatherapi.com/v1/forecast.json?key=${wxKey}&q=${encodeURIComponent(q)}&days=${daysNeeded}&aqi=no&alerts=no`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data: any = await resp.json();
        const fdays: any[] = Array.isArray(data?.forecast?.forecastday) ? data.forecast.forecastday : [];
        for (const d of fdays) {
          const dateStr = String(d?.date || '');
          if (dateStr >= start && dateStr <= end) {
            const rawIcon = String(d?.day?.condition?.icon || '');
            const icon = rawIcon ? (rawIcon.startsWith('http') ? rawIcon : `https:${rawIcon}`) : undefined;
            results.push({ date: dateStr, lo: Math.round(d?.day?.mintemp_f ?? 0), hi: Math.round(d?.day?.maxtemp_f ?? 0), cond: String(d?.day?.condition?.text || '—'), icon });
          }
        }
      }
    } else {
      for (let t = startMs; t <= endMs; t += 24*3600*1000) {
        const dt = new Date(t).toISOString().slice(0,10);
        const url = `https://api.weatherapi.com/v1/future.json?key=${wxKey}&q=${encodeURIComponent(q)}&dt=${dt}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const data: any = await resp.json();
          const day = data?.forecast?.forecastday?.[0]?.day;
          if (day) {
            const rawIcon = String(day?.condition?.icon || '');
            const icon = rawIcon ? (rawIcon.startsWith('http') ? rawIcon : `https:${rawIcon}`) : undefined;
            results.push({ date: dt, lo: Math.round(day?.mintemp_f ?? 0), hi: Math.round(day?.maxtemp_f ?? 0), cond: String(day?.condition?.text || '—'), icon });
          }
        }
      }
    }

    res.status(200).json({ city: resolved.name, resolved, days: results });
  } catch (e: any) {
    const hasProject = !!process.env.FIREBASE_PROJECT_ID;
    const hasEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
    const hasKey = !!process.env.FIREBASE_PRIVATE_KEY;
    res.status(500).json({ error: e?.message || 'Server error', env: { hasProject, hasEmail, hasKey } });
  }
}


