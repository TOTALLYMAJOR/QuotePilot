import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import ProductBrandLockup from "./ProductBrandLockup";
import "./auth0SetupPage.css";

export const AUTH0_SETUP_PATH = "/auth0";

const DEFAULT_AUTH0_DOMAIN = "dev-xsvppgzt3vgy0ydn.us.auth0.com";
const DEFAULT_AUTH0_CLIENT_ID = "cMAurgZ60fCyx8KZLBPfGLumsYtvtjhv";

function clean(value) {
  return String(value || "").trim();
}

export function resolveAuth0Configuration(environment = {}) {
  const domainOverride = clean(environment.VITE_AUTH0_DOMAIN);
  const clientIdOverride = clean(environment.VITE_AUTH0_CLIENT_ID);

  if (Boolean(domainOverride) !== Boolean(clientIdOverride)) {
    return {
      ready: false,
      error: "Set VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID together."
    };
  }

  return {
    ready: true,
    domain: domainOverride || DEFAULT_AUTH0_DOMAIN,
    clientId: clientIdOverride || DEFAULT_AUTH0_CLIENT_ID
  };
}

export function buildAuth0ReturnUrl(origin = window.location.origin) {
  return new URL(AUTH0_SETUP_PATH, origin).toString();
}

export function Auth0IdentityPanel({ returnTo }) {
  const {
    isLoading,
    isAuthenticated,
    error,
    loginWithRedirect,
    logout,
    user
  } = useAuth0();

  const login = () => loginWithRedirect({
    appState: { returnTo: AUTH0_SETUP_PATH }
  });
  const signup = () => loginWithRedirect({
    appState: { returnTo: AUTH0_SETUP_PATH },
    authorizationParams: { screen_hint: "signup" }
  });
  const signOut = () => logout({
    logoutParams: { returnTo }
  });

  if (isLoading) {
    return (
      <main className="auth-shell container">
        <section className="panel auth-card" role="status">
          <ProductBrandLockup className="auth-product-brand" />
          <h1>Checking Auth0 session…</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell container">
      <section className="panel auth-card">
        <ProductBrandLockup className="auth-product-brand" />
        <p className="eyebrow">Developer SDK verification</p>
        <h1>Auth0 React quickstart</h1>
        <p className="muted">
          Use Auth0 Universal Login to verify login, signup, logout, and profile state.
        </p>
        <p className="source-note auth0-authority-boundary" role="note">
          This Auth0 identity is isolated from QuotePilot authorization. It does not create a
          Firebase session, tenant membership, staff role, or Firestore access.
        </p>

        {error && (
          <p className="error-note" role="alert">
            Auth0 could not complete the request: {error.message}
          </p>
        )}

        {isAuthenticated ? (
          <>
            <p>Logged in as <strong>{user?.email || user?.name || "Auth0 user"}</strong></p>
            <h2>User Profile</h2>
            <pre className="auth0-profile-json">{JSON.stringify(user || {}, null, 2)}</pre>
            <div className="auth-actions">
              <button type="button" className="cta" onClick={signOut}>Logout of Auth0</button>
              <a className="ghost button-link" href="/app">Open Firebase Staff Sign In</a>
            </div>
          </>
        ) : (
          <div className="auth-actions">
            <button type="button" className="cta" onClick={signup}>Signup with Auth0</button>
            <button type="button" className="ghost" onClick={login}>Login with Auth0</button>
            <a className="ghost button-link" href="/app">Use Firebase Staff Sign In</a>
          </div>
        )}
      </section>
    </main>
  );
}

export default function Auth0SetupPage() {
  const configuration = resolveAuth0Configuration(import.meta.env);
  const returnTo = buildAuth0ReturnUrl();

  if (!configuration.ready) {
    return (
      <main className="auth-shell container">
        <section className="panel auth-card">
          <ProductBrandLockup className="auth-product-brand" />
          <h1>Auth0 configuration is incomplete</h1>
          <p className="error-note" role="alert">{configuration.error}</p>
        </section>
      </main>
    );
  }

  return (
    <Auth0Provider
      domain={configuration.domain}
      clientId={configuration.clientId}
      authorizationParams={{ redirect_uri: returnTo }}
      onRedirectCallback={() => {
        window.history.replaceState({}, document.title, AUTH0_SETUP_PATH);
      }}
    >
      <Auth0IdentityPanel returnTo={returnTo} />
    </Auth0Provider>
  );
}
