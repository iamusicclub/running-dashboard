"use client";

export default function HomePage() {
  return (
    <main style={{ display: "grid", gap: 24 }}>
      <div
        style={{
          padding: 24,
          borderRadius: 22,
          background: "linear-gradient(135deg, #111827, #1f2937)",
          color: "white",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            letterSpacing: 1,
            textTransform: "uppercase",
            opacity: 0.75,
          }}
        >
          Running Dashboard
        </p>

        <h1 style={{ margin: "10px 0 10px 0", fontSize: 38, lineHeight: 1.1 }}>
          Race-centred running dashboard
        </h1>

        <p
          style={{
            margin: 0,
            maxWidth: 760,
            color: "rgba(255,255,255,0.82)",
            lineHeight: 1.6,
          }}
        >
          The site is being rebuilt around your target races rather than acting as
          a general Strava-style dashboard.
        </p>
      </div>

      <div
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 20,
          boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Next step</h2>
        <p>
          Go to the <strong>Races</strong> page and add your target races. Once
          those are saved, the homepage will be upgraded into a race command
          centre showing target time, target pace, current estimate, and gap to
          goal.
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          <a href="/races">Open Races</a>
          <a href="/runs">Open Runs</a>
          <a href="/analysis">Open Analysis</a>
        </div>
      </div>
    </main>
  );
}
