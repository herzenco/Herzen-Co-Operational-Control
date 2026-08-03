import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Recover access — Herzen Co. Operations" };

export default async function RecoverPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return <main className="companyLogin">
    <section className="loginBrand">
      {/* Vinext's dev runtime does not currently support next/image reliably. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/herzen-logo-white.png" alt="Herzen Co." />
      <div><span>Secure recovery</span><h1>Restore access.<br />Keep work moving.</h1><p>Recovery links are single-use and only issued to approved Herzen Co. identities.</p></div>
      <small>Herzen Co. · Internal systems</small>
    </section>
    <section className="loginPanel"><div className="loginCard">
      <span className="loginEyebrow">Company access</span><h2>Recover OCC access</h2>
      <p>Enter the approved company email associated with your OCC identity.</p>
      {sent && <div className="loginNotice" role="status">If that address is an active OCC member, a secure recovery link has been sent.</div>}
      {error && <div className="loginError" role="alert">The recovery request could not be completed. Wait a moment and try again.</div>}
      <form action="/api/auth/recover" method="post">
        <label>Company email<input name="email" type="email" autoComplete="email" placeholder="name@herzenco.co" required /></label>
        <button type="submit">Send recovery link</button>
      </form>
      <Link className="loginTextLink" href="/login">Return to sign in</Link>
    </div></section>
  </main>;
}
