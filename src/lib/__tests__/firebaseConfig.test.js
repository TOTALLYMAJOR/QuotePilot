import { describe, expect, test } from "vitest";
import {
  buildFirebaseConfig,
  normalizeFirebaseEnvironmentValue
} from "../firebaseConfig";

describe("Firebase browser configuration", () => {
  test("removes deployment-provider whitespace from environment values", () => {
    expect(normalizeFirebaseEnvironmentValue("  tonicatering.firebaseapp.com\n")).toBe(
      "tonicatering.firebaseapp.com"
    );
  });

  test("normalizes every Firebase field before SDK initialization", () => {
    expect(buildFirebaseConfig({
      VITE_FIREBASE_API_KEY: " api-key\n",
      VITE_FIREBASE_AUTH_DOMAIN: "tonicatering.firebaseapp.com\n",
      VITE_FIREBASE_PROJECT_ID: " tonicatering ",
      VITE_FIREBASE_STORAGE_BUCKET: "\ttonicatering.firebasestorage.app",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "692312452587\r\n",
      VITE_FIREBASE_APP_ID: " app-id\n"
    })).toEqual({
      apiKey: "api-key",
      authDomain: "tonicatering.firebaseapp.com",
      projectId: "tonicatering",
      storageBucket: "tonicatering.firebasestorage.app",
      messagingSenderId: "692312452587",
      appId: "app-id"
    });
  });

  test("keeps missing Firebase values empty for the existing fail-closed path", () => {
    expect(buildFirebaseConfig()).toEqual({
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: ""
    });
  });
});
