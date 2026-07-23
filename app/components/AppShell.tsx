"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type IconName =
  | "dashboard"
  | "training"
  | "race"
  | "sheet"
  | "strava"
  | "menu"
  | "close"
  | "sync";

type NavigationItem = {
  label: string;
  href: string;
  icon: IconName;
};

const navigationItems: NavigationItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: "dashboard",
  },
  {
    label: "Training",
    href: "/runs",
    icon: "training",
  },
  {
    label: "Race HQ",
    href: "/races",
    icon: "race",
  },
];

function Icon({
  name,
  size = 20,
}: {
  name: IconName;
  size?: number;
}) {
  const commonProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "dashboard") {
    return (
      <svg {...commonProps}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10.5V20h13v-9.5" />
        <path d="M9.5 20v-6h5v6" />
      </svg>
    );
  }

  if (name === "training") {
    return (
      <svg {...commonProps}>
        <path d="M5.5 19.5c2.5.5 5.5.5 8.5-.5 2.2-.8 3.8-2.4 4.5-4.5" />
        <path d="M4 7.5c2.8.2 4.6 1.4 5.5 3.5l1.2 2.8c.5 1.2 1.7 2 3 2h4.8" />
        <path d="m5 4 2.5 1.5L6 9" />
        <path d="M3.5 16.5c2.2.6 4.2.7 6 .3" />
      </svg>
    );
  }

  if (name === "race") {
    return (
      <svg {...commonProps}>
        <path d="M8 3h8l2 4-2 4H8L6 7l2-4Z" />
        <path d="M12 11v10" />
        <path d="M8 21h8" />
        <path d="m9 7 2 2 4-4" />
      </svg>
    );
  }

  if (name === "sheet") {
    return (
      <svg {...commonProps}>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8" />
        <path d="M8 12h8" />
        <path d="M8 16h3" />
      </svg>
    );
  }

  if (name === "strava") {
    return (
      <svg {...commonProps}>
        <path d="m12 3-4.5 9h5l-2 4" />
        <path d="m14.5 12 2-4 4 8h-4l-2 4-2.5-5" />
      </svg>
    );
  }

  if (name === "menu") {
    return (
      <svg {...commonProps}>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </svg>
    );
  }

  if (name === "close") {
    return (
      <svg {...commonProps}>
        <path d="m6 6 12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M20 11a8 8 0 1 0-2.34 5.66" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

function Brand() {
  return (
    <Link
      href="/"
      className="brand"
      aria-label="Project Sub-3 dashboard"
    >
      <div className="brand-mark" aria-hidden="true">
        <span className="brand-mark-line" />
        <span className="brand-mark-line brand-mark-line-short" />
        <span className="brand-mark-line" />
      </div>

      <div className="brand-copy">
        <span className="brand-project">Project</span>
        <span className="brand-title">Sub-3</span>
        <span className="brand-subtitle">Malaga 2026</span>
      </div>
    </Link>
  );
}

function Navigation({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav
      className="primary-navigation"
      aria-label="Primary navigation"
    >
      {navigationItems.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href ||
              pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`navigation-link ${
              isActive ? "navigation-link-active" : ""
            }`}
            onClick={onNavigate}
          >
            <span className="navigation-icon">
              <Icon name={item.icon} />
            </span>

            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function IntegrationPanel() {
  return (
    <div className="integration-panel">
      <p className="integration-heading">Data sources</p>

      <div className="integration-source">
        <div className="integration-icon integration-icon-sheet">
          <Icon name="sheet" size={18} />
        </div>

        <div className="integration-copy">
          <div className="integration-title-row">
            <span className="integration-title">
              Coach plan
            </span>

            <span className="status-dot status-dot-success" />
          </div>

          <span className="integration-detail">
            Google Sheets connection active
          </span>
        </div>
      </div>

      <div className="integration-divider" />

      <div className="integration-source">
        <div className="integration-icon integration-icon-strava">
          <Icon name="strava" size={18} />
        </div>

        <div className="integration-copy">
          <div className="integration-title-row">
            <span className="integration-title">
              Strava
            </span>

            <span className="status-dot status-dot-success" />
          </div>

          <span className="integration-detail">
            Activity connection active
          </span>
        </div>
      </div>

      <Link href="/runs" className="integration-action">
        <Icon name="sync" size={16} />
        <span>Open training sync</span>
      </Link>
    </div>
  );
}

function Sidebar({
  pathname,
  mobile = false,
  onNavigate,
}: {
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <aside
      className={
        mobile ? "mobile-sidebar" : "desktop-sidebar"
      }
    >
      <div className="sidebar-top">
        <Brand />

        <Navigation
          pathname={pathname}
          onNavigate={onNavigate}
        />
      </div>

      <div className="sidebar-bottom">
        <IntegrationPanel />

        <div className="sidebar-footer">
          <span>16-week marathon block</span>
          <span className="sidebar-footer-separator">
            |
          </span>
          <span>Version 2.0</span>
        </div>
      </div>
    </aside>
  );
}

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const [mobileNavigationOpen, setMobileNavigationOpen] =
    useState(false);

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavigationOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavigationOpen]);

  return (
    <div className="application-shell">
      <Sidebar pathname={pathname} />

      <header className="mobile-header">
        <Brand />

        <button
          type="button"
          className="mobile-menu-button"
          onClick={() =>
            setMobileNavigationOpen(true)
          }
          aria-label="Open navigation"
          aria-expanded={mobileNavigationOpen}
        >
          <Icon name="menu" size={22} />
        </button>
      </header>

      {mobileNavigationOpen && (
        <div className="mobile-navigation-layer">
          <button
            type="button"
            className="mobile-navigation-backdrop"
            onClick={() =>
              setMobileNavigationOpen(false)
            }
            aria-label="Close navigation"
          />

          <div className="mobile-navigation-drawer">
            <div className="mobile-navigation-toolbar">
              <span className="mobile-navigation-title">
                Navigation
              </span>

              <button
                type="button"
                className="mobile-menu-button"
                onClick={() =>
                  setMobileNavigationOpen(false)
                }
                aria-label="Close navigation"
              >
                <Icon name="close" size={22} />
              </button>
            </div>

            <Sidebar
              pathname={pathname}
              mobile
              onNavigate={() =>
                setMobileNavigationOpen(false)
              }
            />
          </div>
        </div>
      )}

      <div className="application-content">
        <main className="page-container">
          {children}
        </main>
      </div>
    </div>
  );
}
