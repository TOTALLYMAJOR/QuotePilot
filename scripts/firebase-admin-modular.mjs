import { createRequire } from "node:module";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));

export function loadFirebaseAdmin() {
  try {
    const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
    const { getAuth } = requireFromFunctions("firebase-admin/auth");
    const { FieldValue, getFirestore } = requireFromFunctions("firebase-admin/firestore");
    return {
      FieldValue,
      getApps,
      getAuth,
      getFirestore,
      initializeApp
    };
  } catch (cause) {
    throw new Error(
      "Firebase Admin dependency is unavailable. Run `npm ci --prefix functions` first.",
      { cause }
    );
  }
}
