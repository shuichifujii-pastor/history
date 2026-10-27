/*
 * 端末間の同期（Firebase Authentication の Google ログイン + Cloud Firestore）
 *
 * ログイン中のユーザーごとに、Firestore の jinmeiProgress/{uid} に学習記録を1件保存する。
 * 端末の記録とクラウドの記録は app.js の mergeStates で項目ごとに統合し、
 * 片方で記録すると、もう片方の端末にもほぼすぐに反映される。
 */
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLLECTION = 'jinmeiProgress';

const app = window.JinmeiApp;
const status = (window.JinmeiSync = { state: 'loading', user: null, lastSync: null, error: '' });
const emit = () => window.dispatchEvent(new Event('jinmei-sync'));
const set = patch => { Object.assign(status, patch); emit(); };

const MESSAGES = {
  'permission-denied': 'Firestore のセキュリティルールで読み書きが許可されていません。README の手順でルールを追加してください。',
  'auth/unauthorized-domain': 'このサイトのドメインが Firebase Authentication の「承認済みドメイン」に登録されていません。',
  'auth/operation-not-allowed': 'Firebase Authentication で Google ログインが有効になっていません。',
  'auth/network-request-failed': 'ネットワークに接続できませんでした。',
  unavailable: 'ネットワークに接続できません。つながると自動的に同期します。',
};
const message = e => MESSAGES[e && e.code] || (e && e.message) || '不明なエラーです。';

// 端末ごとの表示設定（pref）はクラウドに載せない
const serialize = s => { const { pref, ...rest } = s; return JSON.stringify(rest); };

async function start() {
  const config = window.FIREBASE_CONFIG;
  if (!config || !config.apiKey) return set({ state: 'unconfigured' });
  if (!app) return;

  const [{ initializeApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  const fb = initializeApp(config);
  const auth = A.getAuth(fb);
  const db = F.getFirestore(fb);

  let ref = null;           // ログイン中ユーザーのドキュメント
  let unsubscribe = null;
  let lastRemote = '';      // 最後にクラウドと一致していた内容
  let timer = null;

  async function push() {
    timer = null;
    if (!ref) return;
    const json = serialize(app.getState());
    if (json === lastRemote) return;
    set({ state: 'syncing' });
    try {
      await F.setDoc(ref, { data: json, updatedAt: F.serverTimestamp() });
      lastRemote = json;
      set({ state: 'synced', lastSync: new Date(), error: '' });
    } catch (e) {
      set({ state: 'error', error: message(e) });
    }
  }
  const schedule = () => { if (ref && !timer) timer = setTimeout(push, 1200); };
  const flush = () => { if (timer) { clearTimeout(timer); push(); } };
  app.onSave(schedule);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  status.signIn = async () => {
    const provider = new A.GoogleAuthProvider();
    set({ error: '' });
    try {
      await A.signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await A.signInWithRedirect(auth, provider);
      } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        set({ error: message(e) });
      }
    }
  };
  status.signOut = async () => { flush(); await A.signOut(auth); };
  A.getRedirectResult(auth).catch(e => set({ error: message(e) }));

  A.onAuthStateChanged(auth, user => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (timer) { clearTimeout(timer); timer = null; }
    ref = null;
    lastRemote = '';
    if (!user) return set({ state: 'signedOut', user: null });

    set({ state: 'syncing', user: { name: user.displayName, email: user.email }, error: '' });
    ref = F.doc(db, COLLECTION, user.uid);
    unsubscribe = F.onSnapshot(ref, snap => {
      if (snap.metadata.hasPendingWrites) return;   // 自分の書き込み直後の通知は無視
      if (snap.exists()) {
        const raw = snap.data().data;
        try {
          app.applyRemote(JSON.parse(raw));
          lastRemote = raw;
        } catch (e) { /* 壊れたデータは上書きする */ }
      }
      // この端末にしかない記録があればクラウドへ送る（同じ内容なら送らない）
      schedule();
      set({ state: 'synced', lastSync: new Date(), error: '' });
    }, e => set({ state: 'error', error: message(e) }));
  });
}

start().catch(e => set({ state: 'error', error: message(e) }));
