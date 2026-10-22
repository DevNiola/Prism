import NetworkSwitcher from "./NetworkSwitcher";

export default function Header() {
  return (
    <header className="border-b border-slate-800 bg-slate-950">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <span>🔬 Grat</span>
        <NetworkSwitcher />
      </nav>
    </header>
  );
}
