"use client";

export default function ApplicationError({ reset }: { reset: () => void }) {
  return (
    <main className="service-state-shell">
      <section className="service-state-card" role="alert">
        <div className="login-brand"><span>J</span> joyous</div>
        <p className="eyebrow">Service temporarily unavailable</p>
        <h1>We couldn’t load this workspace.</h1>
        <p>No action was taken. Please retry; if the problem continues, contact the application operator.</p>
        <button type="button" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
