import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — Herzen Co. Operations",
  description: "Secure access to the Herzen Co. Operations Control Center.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="companyLogin">
      <section className="loginBrand">
        <img src="/herzen-logo-white.png" alt="Herzen Co." />
        <div>
          <span>Operations Control Center</span>
          <h1>Direction enters here.<br />Execution leaves documented.</h1>
          <p>
            A private operating surface for Lupe and the Herzen Co. agent roster.
          </p>
        </div>
        <small>Herzen Co. · Internal systems</small>
      </section>

      <section className="loginPanel">
        <div className="loginCard">
          <span className="loginEyebrow">Company access</span>
          <h2>Sign in to operations</h2>
          <p>Use the Herzen Co. credentials issued to you.</p>

          {error && (
            <div className="loginError" role="alert">
              We couldn&apos;t verify those credentials. Try again or contact your
              Herzen Co. administrator.
            </div>
          )}

          <form action="/api/auth/login" method="post">
            <label>
              Company email
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@herzen.co"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </label>
            <button type="submit">Enter control center</button>
          </form>

          <small className="loginHelp">
            Access is limited to approved @herzen.co accounts. There is no
            public registration.
          </small>
        </div>
      </section>
    </main>
  );
}
