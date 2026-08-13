import { ReCaptchaEnterpriseProvider, initializeAppCheck } from "firebase/app-check";

export async function initializeConfiguredAppCheck(app, siteKey) {
  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true
  });
}
