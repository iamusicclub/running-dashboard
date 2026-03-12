export default function Home() {
  return (
    <main style={{ padding: 40, fontFamily: "Arial" }}>
      <h1>Running Dashboard</h1>
      <p>Welcome to your running analytics dashboard.</p>

      <ul>
        <li><a href="/runs">Runs</a></li>
        <li><a href="/predictions">Predictions</a></li>
        <li><a href="/analysis">Training Analysis</a></li>
        <li><a href="/races">Race Planner</a></li>
      </ul>
    </main>
  );
}
