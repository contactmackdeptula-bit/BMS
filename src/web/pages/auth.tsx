import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError } from "../api";
import { Button, ErrorPanel, Notice } from "../ui/basics";
import { Input } from "../ui/forms";
import { ROLE_LABELS } from "../format";

// The product name is configuration (SPEC.md §1). Auth pages render before /me,
// so they read it from the build-time variable with the same default.
const PRODUCT = import.meta.env.VITE_PRODUCT_NAME ?? "Fabric";
const TAGLINE = import.meta.env.VITE_PRODUCT_TAGLINE ?? "Church buildings, in order";

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · ${PRODUCT}`;
  }, [title]);
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="wordmark">{PRODUCT}</div>
          <div className="tagline">{TAGLINE}</div>
        </div>
        <h1 className="page-title" style={{ fontSize: 22 }}>
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}

/** Only follow same-site paths after sign-in. */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

export function LoginPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit(async () => {
    await api.post("/auth/login", { email, password });
    window.location.assign(safeNext(params.get("next")));
  });
  return (
    <AuthCard title="Sign in">
      {error && <ErrorPanel message={error} />}
      <form onSubmit={submit} noValidate>
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button variant="primary" type="submit" loading={busy}>
          Sign in
        </Button>
      </form>
      <Link to="/forgot-password">Forgotten your password?</Link>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        New here? Ask your PCC admin to invite you. The invitation email has a link to set your password.
      </p>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await api.post("/auth/password/reset-request", { email });
    setSent(true);
  });
  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <Notice>
          If {email} has an account, we've sent it a link to choose a new password. The link works for one hour.
        </Notice>
      ) : (
        <>
          {error && <ErrorPanel message={error} />}
          <form onSubmit={submit} noValidate>
            <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button variant="primary" type="submit" loading={busy}>
              Email me a link
            </Button>
          </form>
        </>
      )}
      <Link to="/login">Back to sign in</Link>
    </AuthCard>
  );
}

const PASSWORD_HINT = "At least 10 characters. A short phrase of a few words works well.";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit(async () => {
    await api.post("/auth/password/reset", { token: params.get("token") ?? "", password });
    window.location.assign("/");
  });
  return (
    <AuthCard title="Choose a new password">
      {error && <ErrorPanel message={error} />}
      <form onSubmit={submit} noValidate>
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button variant="primary" type="submit" loading={busy}>
          Save and sign in
        </Button>
      </form>
    </AuthCard>
  );
}

type InviteInfo = { email: string; organisation: string; role: string; hasAccount: boolean };

export function InvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    api
      .get<InviteInfo>(`/auth/invite?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e: ApiError) => setLoadError(e.message));
  }, [token]);

  const { busy, error, submit } = useSubmit(async () => {
    await api.post("/auth/invite/accept", { token, name, password });
    navigate("/", { replace: true });
    window.location.reload();
  });

  if (loadError) {
    return (
      <AuthCard title="Invitation">
        <ErrorPanel message={loadError} />
        <Link to="/login">Go to sign in</Link>
      </AuthCard>
    );
  }
  if (!info) return <AuthCard title="Invitation">{null}</AuthCard>;

  return (
    <AuthCard title={`Join ${info.organisation}`}>
      <p style={{ margin: 0 }}>
        You've been invited as <strong>{ROLE_LABELS[info.role] ?? info.role}</strong> using <strong>{info.email}</strong>.
      </p>
      {error && <ErrorPanel message={error} />}
      <form onSubmit={submit} noValidate>
        {info.hasAccount ? (
          <Input
            label="Your current password"
            type="password"
            autoComplete="current-password"
            hint="You already have an account, so confirm it's you."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        ) : (
          <>
            <Input label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              label="Choose a password"
              type="password"
              autoComplete="new-password"
              hint={PASSWORD_HINT}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        <Button variant="primary" type="submit" loading={busy}>
          Accept and sign in
        </Button>
      </form>
    </AuthCard>
  );
}
