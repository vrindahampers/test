// =====================================================================
// FIREBASE CONFIG
// 1. Go to https://console.firebase.google.com and create a project
// 2. Project settings > Your apps > Web app > copy the firebaseConfig
// 3. Paste it below (replacing the placeholder values)
// NEVER put any "service account" / private keys in this file!
// =====================================================================

const firebaseConfig = {
  apiKey: "AIzaSyAHM-ghz1AWKTSqbiOMylms78mMkNM7How",
  authDomain: "chatting-7ca26.firebaseapp.com",
  databaseURL: "https://chatting-7ca26-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "chatting-7ca26",
  storageBucket: "chatting-7ca26.firebasestorage.app",
  messagingSenderId: "281403563596",
  appId: "1:281403563596:web:725d1b3ea09845339e9ee9",
  measurementId: "G-48NP604YMX"
};

// Initialize Firebase (compat SDK v10 — simple to read for beginners)
firebase.initializeApp(firebaseConfig);

// Shortcuts used everywhere in the app
const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();
