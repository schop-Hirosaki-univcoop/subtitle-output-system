// firebase-config.js: Firebaseアプリ共通の接続設定を集約します。
// 質問フォームとオペレーターコンソールの両方で同一設定を参照できるようにし、
// 重複定義による設定ずれを防ぎます。

export const FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyBh54ZKsM6uNph61QrP-Ypu7bzU_PHbNcY",
  authDomain: "subtitle-output-system-9bc14.firebaseapp.com",
  databaseURL: "https://subtitle-output-system-9bc14-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "subtitle-output-system-9bc14",
  storageBucket: "subtitle-output-system-9bc14.firebasestorage.app",
  messagingSenderId: "378400426909",
  appId: "1:378400426909:web:f1549aad61e3f7aacebd74"
});
