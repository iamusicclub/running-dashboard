import "./globals.css";

export const metadata = {
  title: "Running Dashboard",
  description: "Running analytics and race predictions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif", background: "#f4f7fc" }}>
        <header
          style={{
            background: "#1d4ed8",
            color: "white",
            padding: "16px 24px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          <div
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <a
              href="/"
              style={{
                color: "white",
                fontWeight: 700,
                fontSize: 18,
                textDecoration: "none",
              }}
            >
              Running Dashboard
            </a>

            <nav style={{ display: "flex", gap: 16 }}>
              <a style={navLink} href="/">Dashboard</a>
              <a style={navLink} href="/runs">Runs</a>
              <a style={navLink} href="/predictions">Predictions</a>
              <a style={navLink} href="/analysis">Analysis</a>
              <a style={navLink} href="/races">Races</a>
            </nav>
          </div>
        </header>

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
          {children}
        </div>
      </body>
    </html>
  );
}

const navLink: React.CSSProperties = {
  color: "white",
  textDecoration: "none",
  fontWeight: 500,
  padding: "6px 10px",
  borderRadius: 6,
};
