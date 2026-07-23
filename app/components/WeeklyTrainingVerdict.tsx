import type {
  TrainingCategoryAssessment,
  TrainingCategoryStatus,
  TrainingInsight,
  TrainingInsightTone,
  WeeklyTrainingAssessment,
} from "../../lib/training-intelligence";

type WeeklyTrainingVerdictProps = {
  assessment: WeeklyTrainingAssessment;
  weekLabel: string;
  phaseLabel: string;
};

function getToneClass(tone: TrainingInsightTone) {
  if (tone === "positive") {
    return "tone-positive";
  }

  if (tone === "warning") {
    return "tone-warning";
  }

  if (tone === "critical") {
    return "tone-critical";
  }

  return "tone-neutral";
}

function getCategoryStatusClass(status: TrainingCategoryStatus) {
  if (status === "completed") {
    return "status-completed";
  }

  if (status === "partial") {
    return "status-partial";
  }

  if (status === "missed") {
    return "status-missed";
  }

  return "status-neutral";
}

function formatDistance(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  return `${value.toFixed(1)} km`;
}

function CategoryAssessmentCard({
  category,
}: {
  category: TrainingCategoryAssessment;
}) {
  return (
    <article className="category-card">
      <div className="category-card-heading">
        <span>{category.label}</span>

        <strong className={getCategoryStatusClass(category.status)}>
          {category.statusLabel}
        </strong>
      </div>

      <p>{category.context}</p>
    </article>
  );
}

function InsightCard({
  insight,
}: {
  insight: TrainingInsight;
}) {
  return (
    <article
      className={`insight-card ${getToneClass(insight.tone)}`}
    >
      <span className="insight-indicator" aria-hidden="true" />

      <div>
        <strong>{insight.title}</strong>
        <p>{insight.detail}</p>
      </div>
    </article>
  );
}

export default function WeeklyTrainingVerdict({
  assessment,
  weekLabel,
  phaseLabel,
}: WeeklyTrainingVerdictProps) {
  const distanceContext =
    assessment.plannedDistanceKm === null
      ? "The coach plan does not contain enough numerical distance targets for a full comparison."
      : `${formatDistance(
          assessment.completedDistanceKm
        )} completed against approximately ${formatDistance(
          assessment.plannedDistanceKm
        )} planned.`;

  return (
    <section className="surface-card weekly-verdict-card">
      <header className="weekly-verdict-header">
        <div>
          <p className="section-label">Training intelligence</p>
          <h2>Weekly training verdict</h2>

          <div className="weekly-meta">
            <span>{weekLabel}</span>
            <i aria-hidden="true" />
            <span>{phaseLabel}</span>
          </div>
        </div>

        <div className={`headline-verdict ${getToneClass(assessment.tone)}`}>
          <small>{assessment.label}</small>
        </div>
      </header>

      <div className="weekly-summary">
        <p>{assessment.summary}</p>
      </div>

      <div className="weekly-headline-metrics">
        <article>
          <span>Due sessions</span>
          <strong>{assessment.dueSessionCount}</strong>
          <small>
            {assessment.plannedSessionCount} sessions in the full week
          </small>
        </article>

        <article>
          <span>Completed</span>
          <strong>{assessment.completedSessionCount}</strong>
          <small>
            {assessment.partialSessionCount} partial |{" "}
            {assessment.missedSessionCount} missed
          </small>
        </article>

        <article>
          <span>Completed distance</span>
          <strong>
            {formatDistance(assessment.completedDistanceKm)}
          </strong>
          <small>{distanceContext}</small>
        </article>

        <article>
          <span>Distance completion</span>
          <strong>
            {assessment.distanceCompletionPercentage === null
              ? "N/A"
              : `${assessment.distanceCompletionPercentage}%`}
          </strong>
          <small>
            {assessment.distanceDifferenceKm === null
              ? "No measurable weekly target"
              : assessment.distanceDifferenceKm === 0
              ? "Exactly aligned with plan"
              : `${Math.abs(
                  assessment.distanceDifferenceKm
                ).toFixed(1)} km ${
                  assessment.distanceDifferenceKm > 0
                    ? "above"
                    : "below"
                } plan`}
          </small>
        </article>
      </div>

      <div className="category-section">
        <div className="subsection-heading">
          <div>
            <span>Execution breakdown</span>
            <h3>Where the week is working</h3>
          </div>
        </div>

        <div className="category-grid">
          {assessment.categoryAssessments.map((category) => (
            <CategoryAssessmentCard
              key={category.key}
              category={category}
            />
          ))}
        </div>
      </div>

      <div className="insight-grid">
        <section>
          <div className="subsection-heading">
            <div>
              <span>Positive evidence</span>
              <h3>Strengths</h3>
            </div>
          </div>

          <div className="insight-list">
            {assessment.strengths.length > 0 ? (
              assessment.strengths.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                />
              ))
            ) : (
              <div className="empty-insight">
                <strong>No clear strength identified yet</strong>
                <p>
                  More completed sessions are required before the
                  strongest part of the week can be identified.
                </p>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="subsection-heading">
            <div>
              <span>Areas to monitor</span>
              <h3>Concerns</h3>
            </div>
          </div>

          <div className="insight-list">
            {assessment.concerns.length > 0 ? (
              assessment.concerns.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                />
              ))
            ) : (
              <div className="empty-insight empty-insight-positive">
                <strong>No material concern identified</strong>
                <p>
                  The available plan-versus-actual evidence does not
                  currently highlight a significant problem.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      <style jsx>{`
        .weekly-verdict-card {
          padding: 24px;
        }

        .weekly-verdict-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
        }

        .weekly-verdict-header h2 {
          margin: 5px 0 0;
          color: var(--colour-slate-950);
          font-size: 24px;
          font-weight: 760;
          letter-spacing: -0.035em;
        }

        .weekly-meta {
          margin-top: 11px;
          display: flex;
          align-items: center;
          gap: 9px;
          color: var(--colour-slate-500);
          font-size: 11px;
          font-weight: 650;
        }

        .weekly-meta i {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: var(--colour-slate-300);
        }

        .headline-verdict {
          min-width: 132px;
          padding: 15px 17px;
          border-radius: 14px;
          text-align: right;
        }

        .headline-verdict small {
          display: block;
          font-size: 12px;
          font-weight: 760;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .headline-verdict.tone-positive {
          color: #166534;
          background: #dcfce7;
        }

        .headline-verdict.tone-neutral {
          color: #1d4ed8;
          background: #dbeafe;
        }

        .headline-verdict.tone-warning {
          color: #92400e;
          background: #fef3c7;
        }

        .headline-verdict.tone-critical {
          color: #b91c1c;
          background: #fee2e2;
        }

        .weekly-summary {
          margin-top: 22px;
          padding: 18px;
          border: 1px solid var(--colour-border);
          border-radius: 13px;
          background: var(--colour-slate-50);
        }

        .weekly-summary p {
          margin: 0;
          color: var(--colour-slate-700);
          font-size: 14px;
          line-height: 1.7;
        }

        .weekly-headline-metrics {
          margin-top: 17px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 11px;
        }

        .weekly-headline-metrics article {
          min-height: 126px;
          padding: 15px;
          border: 1px solid var(--colour-border);
          border-radius: 12px;
          background: #ffffff;
        }

        .weekly-headline-metrics span {
          display: block;
          color: var(--colour-slate-500);
          font-size: 9px;
          font-weight: 760;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .weekly-headline-metrics strong {
          margin-top: 10px;
          display: block;
          color: var(--colour-slate-950);
          font-size: 24px;
          font-weight: 790;
          letter-spacing: -0.04em;
        }

        .weekly-headline-metrics small {
          margin-top: 7px;
          display: block;
          color: var(--colour-slate-500);
          font-size: 10px;
          line-height: 1.5;
        }

        .category-section {
          margin-top: 28px;
        }

        .subsection-heading span {
          color: var(--colour-blue-600);
          font-size: 9px;
          font-weight: 780;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .subsection-heading h3 {
          margin: 5px 0 0;
          color: var(--colour-slate-950);
          font-size: 17px;
          font-weight: 730;
          letter-spacing: -0.02em;
        }

        .category-grid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 11px;
        }

        .category-card {
          padding: 15px;
          border: 1px solid var(--colour-border);
          border-radius: 12px;
          background: var(--colour-slate-50);
        }

        .category-card-heading {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }

        .category-card-heading span {
          color: var(--colour-slate-700);
          font-size: 11px;
          font-weight: 700;
        }

        .category-card-heading strong {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-align: right;
          text-transform: uppercase;
        }

        .status-completed {
          color: #166534;
        }

        .status-partial {
          color: #92400e;
        }

        .status-missed {
          color: #b91c1c;
        }

        .status-neutral {
          color: #475569;
        }

        .category-card p {
          margin: 11px 0 0;
          color: var(--colour-slate-500);
          font-size: 10px;
          line-height: 1.55;
        }

        .insight-grid {
          margin-top: 28px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .insight-list {
          margin-top: 14px;
          display: grid;
          gap: 9px;
        }

        .insight-card {
          position: relative;
          padding: 14px 14px 14px 18px;
          display: grid;
          grid-template-columns: 5px minmax(0, 1fr);
          gap: 11px;
          border: 1px solid var(--colour-border);
          border-radius: 11px;
          background: #ffffff;
        }

        .insight-indicator {
          width: 5px;
          min-height: 100%;
          border-radius: 999px;
          background: var(--colour-slate-300);
        }

        .insight-card strong {
          color: var(--colour-slate-950);
          font-size: 12px;
          font-weight: 720;
        }

        .insight-card p {
          margin: 5px 0 0;
          color: var(--colour-slate-500);
          font-size: 10px;
          line-height: 1.55;
        }

        .tone-positive {
          border-color: #bbf7d0;
          background: #f0fdf4;
        }

        .tone-positive .insight-indicator {
          background: #16a34a;
        }

        .tone-warning {
          border-color: #fde68a;
          background: #fffbeb;
        }

        .tone-warning .insight-indicator {
          background: #d97706;
        }

        .tone-critical {
          border-color: #fecaca;
          background: #fef2f2;
        }

        .tone-critical .insight-indicator {
          background: #dc2626;
        }

        .tone-neutral {
          background: var(--colour-slate-50);
        }

        .empty-insight {
          padding: 16px;
          border: 1px dashed var(--colour-slate-300);
          border-radius: 11px;
          background: var(--colour-slate-50);
        }

        .empty-insight-positive {
          border-color: #bbf7d0;
          background: #f0fdf4;
        }

        .empty-insight strong {
          color: var(--colour-slate-800);
          font-size: 12px;
        }

        .empty-insight p {
          margin: 6px 0 0;
          color: var(--colour-slate-500);
          font-size: 10px;
          line-height: 1.55;
        }

        @media (max-width: 1050px) {
          .weekly-headline-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .category-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .weekly-verdict-header {
            align-items: stretch;
            flex-direction: column;
          }

          .headline-score {
            width: 100%;
            text-align: left;
          }

          .headline-score > div {
            justify-content: flex-start;
          }

          .insight-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 520px) {
          .weekly-headline-metrics,
          .category-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
