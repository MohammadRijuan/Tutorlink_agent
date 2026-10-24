"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Sign-in failed.");
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); } finally { setBusy(false); }
  }
  return <main className="login-screen"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark login-mark">T/</div><p className="login-kicker">TUTORLINK / PRIVATE WORKSPACE</p><h1>Sign in</h1><p className="login-description">Access is restricted to authorized administrators.</p>
    <label htmlFor="email">Administrator email</label><input id="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
    <label htmlFor="password">Password</label><div className="password-field"><input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
    {error && <p className="login-error" role="alert">{error}</p>}<button className="action-button login-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button>
    <p className="login-footnote">Do not share your administrator credentials. Sessions expire after 8 hours.</p>
  </form></main>;
}
