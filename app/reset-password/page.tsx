import type { Metadata } from "next";

export const metadata: Metadata = { title: "Set password — Herzen Co. Operations" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="companyLogin">
    <section className="loginBrand">
      {/* Vinext's dev runtime does not currently support next/image reliably. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/herzen-logo-white.png" alt="Herzen Co." />
      <div><span>Secure recovery</span><h1>Choose a new<br />operations password.</h1><p>Use a unique password stored in your approved secret manager.</p></div>
      <small>Herzen Co. · Internal systems</small>
    </section>
    <section className="loginPanel"><div className="loginCard">
      <span className="loginEyebrow">Protected action</span><h2>Set a new password</h2>
      <p>The recovery link must be opened before this password can be changed.</p>
      {error && <div className="loginError" role="alert">{error === "session" ? "This recovery link is invalid or expired. Request a new one." : "Use at least 12 characters and make sure both passwords match."}</div>}
      <form action="/api/auth/update-password" method="post">
        <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
        <label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
        <button type="submit">Update password</button>
      </form>
    </div></section>
  </main>;
}
