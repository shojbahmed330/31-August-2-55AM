import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBLaOaW9TwZEMEoZOm8PA-1rM-sQSghpkM",
  authDomain: "voicesocial-56a00.firebaseapp.com",
  projectId: "voicesocial-56a00",
  storageBucket: "voicesocial-56a00.firebasestorage.app",
  messagingSenderId: "576952416734",
  appId: "1:576952416734:web:4895dc1abd06d7eb5a454f",
  measurementId: "G-K79J8XZH73"
};

// Initialize Firebase
const app = !firebase.apps.length ? firebase.initializeApp(firebaseConfig) : firebase.app();
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Use browserSessionPersistence for Auth. This is more reliable in some sandboxed environments.
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
  .catch((error) => {
    console.error("Firebase: Auth session persistence failed. User may not stay logged in.", error);
  });

// Enable Firestore persistence to allow for offline functionality.
db.enablePersistence({ synchronizeTabs: true })
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn("Firestore persistence failed: can only be enabled in one tab at a time.");
    } else if (err.code === 'unimplemented') {
      console.warn("Firestore persistence failed: browser does not support this feature.");
    }
  });


export { auth, db, storage, app };
