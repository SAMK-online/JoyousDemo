export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; role?: string }>;
}) {
  const params = await searchParams;
  const initialRole = params.role === "product" ? "product" : "patient";

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><span>J</span> joyous</div>
        <p className="eyebrow">Secure synthetic workspace</p>
        <h1 id="login-title">Sign in to continue</h1>
        <p>Choose the workspace that matches your role. Access expires after eight hours.</p>
        {params.error && <div className="login-error" role="alert">That password is not valid for this workspace.</div>}
        <form action="/api/auth/login" method="post">
          <label htmlFor="role">Workspace</label>
          <select id="role" name="role" defaultValue={initialRole}>
            <option value="patient">Patient assistant</option>
            <option value="product">Product insights</option>
          </select>
          <label htmlFor="password">Access password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button type="submit">Continue securely</button>
        </form>
        <small>This environment contains synthetic demonstration data only.</small>
      </section>
    </main>
  );
}
