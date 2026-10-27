/*
 * Firebase の設定
 *
 * Firebase コンソール → ⚙ プロジェクトの設定 → 「マイアプリ」のウェブアプリにある
 * firebaseConfig の中身を、下の null の代わりに貼り付けてください。
 *
 *   window.FIREBASE_CONFIG = {
 *     apiKey: "...",
 *     authDomain: "...",
 *     projectId: "...",
 *     storageBucket: "...",
 *     messagingSenderId: "...",
 *     appId: "...",
 *   };
 *
 * この値は公開されても問題ないもの（Webアプリの識別用）です。
 * データの保護は Firestore のセキュリティルールで行います（README 参照）。
 * null のままなら同期機能は表示されず、これまでどおり端末内だけで動きます。
 */
window.FIREBASE_CONFIG = null;
