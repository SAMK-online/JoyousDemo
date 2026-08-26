import { ProductInsightsChat } from "@/components/ProductInsightsChat";
import { getInsightsReport } from "@/lib/api/backendClient";

export const dynamic = "force-dynamic";

export default async function ProductInsightsPage() {
  const report = await getInsightsReport();
  const highPriorityCount = report.themes.filter((theme) => theme.priority === "high").length;
  const needsWorkCount = report.coverageSummary.partial + report.coverageSummary.gap;

  return (
    <main className="insights-shell">
      <a className="skip-link" href="#insights-content">Skip to report</a>
      <header className="insights-topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">J</div>
          <div>
            <p className="brand-name">joyous</p>
            <p className="brand-subtitle">Product learning</p>
          </div>
        </div>
        <div className="insights-topbar-actions">
          <span className="environment-badge"><span /> Synthetic data</span>
          <form action="/api/auth/logout" method="post">
            <button className="workspace-logout" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <section className="insights-content" id="insights-content">
        <div className="insights-hero">
          <div>
            <p className="eyebrow">Internal · Offline Tier 3 stream</p>
            <h1>What patients need the assistant to understand next</h1>
            <p>
              Aggregated visit-conversation themes compared with current Tier 1 capabilities.
              This report does not change live patient answers.
            </p>
          </div>
          <aside className="report-summary" aria-label="Report summary">
            <span className="report-date">Data through Aug 19, 2026</span>
            <div>
              <span><strong>{highPriorityCount}</strong> high-priority signals</span>
              <span><strong>{needsWorkCount}</strong> themes need coverage work</span>
            </div>
          </aside>
        </div>

        <div className="insight-metrics" aria-label="Report metrics">
          <div className="metric-primary"><span>Patients</span><strong>{report.totalPatients}</strong><small>Synthetic cohort</small></div>
          <div><span>Visits analyzed</span><strong>{report.totalVisits}</strong><small>Provider conversations</small></div>
          <div><span>Patient utterances</span><strong>{report.patientUtteranceCount}</strong><small>Analyzed offline</small></div>
          <div><span>Explicit questions</span><strong>{report.explicitQuestionCount}</strong><small>Directly phrased needs</small></div>
          <div><span>Themes found</span><strong>{report.themes.length}</strong><small>Prioritized signals</small></div>
        </div>

        <ProductInsightsChat />

        <section className="coverage-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Tier 1 coverage</p>
              <h2>Coverage at a glance</h2>
            </div>
            <p>Theme-level assessment for product discovery, not a clinical quality score.</p>
          </div>
          <div className="coverage-grid">
            <div className="coverage-card coverage-covered">
              <span>Covered</span><strong>{report.coverageSummary.covered}</strong>
              <small>Existing Tier 1 behavior handles the core need.</small>
            </div>
            <div className="coverage-card coverage-partial">
              <span>Partial</span><strong>{report.coverageSummary.partial}</strong>
              <small>The assistant can help, but important context or guidance is missing.</small>
            </div>
            <div className="coverage-card coverage-gap">
              <span>Gap</span><strong>{report.coverageSummary.gap}</strong>
              <small>No approved Tier 1 capability fully addresses the need.</small>
            </div>
          </div>
        </section>

        <section className="themes-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Prioritized backlog</p>
              <h2>Conversation themes</h2>
            </div>
            <p>High-priority themes appear first; counts are aggregated across synthetic patients.</p>
          </div>

          <div className="theme-list">
            {report.themes.map((theme, index) => (
              <article className="theme-card" key={theme.id}>
                <div className="theme-card-heading">
                  <div>
                    <div className="theme-meta-row">
                      <span className="theme-index">{String(index + 1).padStart(2, "0")}</span>
                      <div className="theme-badges">
                        <span className={`priority priority-${theme.priority}`}>{theme.priority} priority</span>
                        <span className={`coverage coverage-${theme.coverage}`}>{theme.coverage}</span>
                      </div>
                    </div>
                    <h3>{theme.title}</h3>
                    <p>{theme.description}</p>
                  </div>
                  <div className="theme-counts">
                    <strong>{theme.patientCount}</strong>
                    <span>patient{theme.patientCount === 1 ? "" : "s"}</span>
                    <small>{theme.mentionCount} matched utterance{theme.mentionCount === 1 ? "" : "s"}</small>
                  </div>
                </div>

                <div className="theme-example">
                  <span>Representative need</span>
                  <p>“{theme.example}”</p>
                </div>

                <div className="theme-actions">
                  <div>
                    <span>Current Tier 1</span>
                    <p>{theme.currentCapability}</p>
                  </div>
                  <div>
                    <span>Product opportunity</span>
                    <p>{theme.opportunity}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="methodology-card">
          <div>
            <p className="eyebrow">Data boundary</p>
            <h2>How this stream works</h2>
          </div>
          <ul>
            {report.methodology.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      </section>
    </main>
  );
}
