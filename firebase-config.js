// Firebase project settings.
// Firebase console → Project settings → General → "Your apps" → Web app → SDK setup and configuration.
// Only apiKey and projectId are used. The Web API key is not a secret: access is
// enforced by firestore.rules.
//
// Why there's no `initializeApp()` from the Firebase JS SDK here:
//   • MV3 forbids remotely hosted code, so the SDK would have to be bundled with npm.
//   • The full Firestore SDK uses XMLHttpRequest, which MV3 service workers don't have.
// So shared/firebase.js talks to the same Firebase Auth and Firestore backends over their
// REST APIs with fetch(). Same data, same security rules, zero dependencies.

export const firebaseConfig = {
  apiKey: 'AIzaSyDi5d6oGNJBA6QKlAuUDI3S_DRTHhNe_jU',
  authDomain: 'daily-sync-1dcb3.firebaseapp.com',
  projectId: 'daily-sync-1dcb3',
};

export function isFirebaseConfigured() {
  return !Object.values(firebaseConfig).some((v) => v.includes('YOUR_'));
}

/** Equivalent of initializeApp(): validated endpoints for the REST client. */
export function initFirebase() {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured: fill in firebase-config.js');
  const { apiKey, projectId } = firebaseConfig;
  return {
    apiKey,
    projectId,
    firestoreBase: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`,
    authBase: 'https://identitytoolkit.googleapis.com/v1',
    tokenUrl: 'https://securetoken.googleapis.com/v1/token',
  };
}
