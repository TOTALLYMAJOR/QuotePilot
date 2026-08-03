export function normalizeFirebaseEnvironmentValue(value) {
  return String(value ?? "").trim();
}

export function buildFirebaseConfig(env = {}) {
  return {
    apiKey: normalizeFirebaseEnvironmentValue(env.VITE_FIREBASE_API_KEY),
    authDomain: normalizeFirebaseEnvironmentValue(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: normalizeFirebaseEnvironmentValue(env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: normalizeFirebaseEnvironmentValue(env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: normalizeFirebaseEnvironmentValue(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: normalizeFirebaseEnvironmentValue(env.VITE_FIREBASE_APP_ID)
  };
}
