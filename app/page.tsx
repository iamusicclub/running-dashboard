export default function Home() {
  return (
    <main style={{padding:40}}>
      <h1>Running Dashboard</h1>
      <p>Your running website is live.</p>

      <ul>
        <li><a href="/runs">Runs</a></li>
        <li><a href="/predictions">Predictions</a></li>
        <li><a href="/analysis">Training Analysis</a></li>
        <li><a href="/races">Race Planner</a></li>
      </ul>
    </main>
  )
}
