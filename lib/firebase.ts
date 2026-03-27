import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, createUserWithEmailAndPassword, updateProfile, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase variables
let app;
let analytics;
let auth: any;
let googleProvider: GoogleAuthProvider;
let db: any;

try {
  if (firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    analytics = getAnalytics(app);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    db = getFirestore(app);
  } else {
    console.warn("Firebase Config missing! Firebase services will not work.");
  }
} catch (error) {
  console.error("Error initializing Firebase:", error);
}

export { auth, googleProvider, db, analytics };

// Auth Helper Functions

// 1. Sign In: Checks if user exists in DB first
export const signInWithGoogle = async () => {
    if (!auth || !db) throw new Error("Firebase not initialized");
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        
        // Check if user exists in Firestore
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (!userDoc.exists()) {
            await signOut(auth);
            throw new Error("User not found. Please sign up first.");
        }

        return user;
    } catch (error) {
        console.error("Error signing in with Google", error);
        throw error;
    }
};

// 2. Sign Up: Creates new user in DB (or logs in existing)
export const signUpWithGoogle = async () => {
    if (!auth || !db) throw new Error("Firebase not initialized");
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
             await setDoc(userDocRef, {
                lastLogin: serverTimestamp()
            }, { merge: true });
            return user;
        }

        await setDoc(userDocRef, {
            uid: user.uid,
            name: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp()
        }, { merge: true });

        return user;
    } catch (error) {
        console.error("Error signing up with Google", error);
        throw error;
    }
};

// 3. Email Sign Up: Creates new user with email/password
export const signUpWithEmail = async (email: string, password: string, name: string) => {
    if (!auth || !db) throw new Error("Firebase not initialized");
    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const user = result.user;

        await updateProfile(user, { displayName: name });

        const userDocRef = doc(db, "users", user.uid);
        await setDoc(userDocRef, {
            uid: user.uid,
            name: name,
            email: email,
            photoURL: null,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp()
        }, { merge: true });

        return user;
    } catch (error) {
        console.error("Error signing up with email", error);
        throw error;
    }
};

// 4. Email Sign In
export const signInWithEmail = async (email: string, password: string) => {
    if (!auth || !db) throw new Error("Firebase not initialized");
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result.user;
    } catch (error) {
        console.error("Error signing in with email", error);
        throw error;
    }
};

export const logout = async () => {
    if (!auth) return;
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error signing out", error);
        throw error;
    }
};
