"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NetworkSwitcher from "./NetworkSwitcher";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/decode", label: "Decode" },
  { href: "/trace", label: "Trace" },
  { href: "/debug", label: "Debug" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu when navigating
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Close menu on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  return (
    <header
      className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm"
      role="banner"
    >
      <nav
        className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-slate-100 font-bold text-lg hover:text-violet-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
          aria-label="Grat — Home"
        >
          <span aria-hidden="true">🔬</span>
          <span>Grat</span>
        </Link>

        {/* Desktop nav links */}
        <ul
          className="hidden md:flex items-center gap-1"
          role="list"
          aria-label="Navigation links"
        >
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  pathname === href
                    ? "text-violet-400 bg-violet-950/40"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Desktop network switcher */}
        <div className="hidden md:flex items-center">
          <NetworkSwitcher />
        </div>

        {/* Mobile hamburger button */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          {/* Hamburger / X icon */}
          {menuOpen ? (
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile slide-down menu */}
      <div
        id="mobile-menu"
        ref={menuRef}
        role="region"
        aria-label="Mobile navigation menu"
        aria-hidden={!menuOpen}
        className={`md:hidden overflow-hidden transition-all duration-200 ease-in-out border-t border-slate-800 ${
          menuOpen ? "max-h-80 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <ul
          className="px-4 py-3 space-y-1"
          role="list"
          aria-label="Mobile navigation links"
        >
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  pathname === href
                    ? "text-violet-400 bg-violet-950/40"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                }`}
                tabIndex={menuOpen ? 0 : -1}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Network switcher in mobile menu */}
        <div className="px-4 pb-4 pt-1 border-t border-slate-800/50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Network
          </p>
          <NetworkSwitcher />
        </div>
      </div>
    </header>
  );
}
