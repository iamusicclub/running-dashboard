import "./globals.css";

export const metadata = {
  title: "Running Dashboard",
  description: "Running analytics, predictions, and training insights",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-shell nav-inner">
            <a href="/" className="brand">
              Running Dashboard
            </a>

            <nav className="top-nav">
              <a href="/">Dashboard</a>
              <a href="/runs">Runs</a>
              <a href="/predictions">Predictions</a>
              <a href="/analysis">Analysis</a>
              <a href="/races">Races</a>
            </nav>
          </div>
        </header>

        <div className="site-shell page-wrap">{children}</div>
      </body>
    </html>
  );
}
