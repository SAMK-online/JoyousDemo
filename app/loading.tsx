export default function Loading() {
  return (
    <main className="service-state-shell" aria-live="polite" aria-busy="true">
      <section className="service-state-card service-loading">
        <div className="login-brand"><span>J</span> joyous</div>
        <div className="loading-line loading-title" />
        <div className="loading-line" />
        <div className="loading-line loading-short" />
        <span className="sr-only">Loading workspace</span>
      </section>
    </main>
  );
}
