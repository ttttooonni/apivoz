import { Link, useRouterState } from "@tanstack/react-router";
import { Archive, CircleHelp, Hexagon, History, Home, Scale, Shield } from "lucide-react";
import type { ReactNode } from "react";
import { InstallAppButton } from "@/components/apiary/install-app";
import { useTutorial } from "@/components/apiary/tutorial";
import { VoiceFillButton, VoiceFillFab } from "@/components/apiary/voice-fill";
import { HiveMark } from "@/components/brand/hive-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Inicio", icon: Home, exact: true },
  { to: "/apiarios", label: "Apiarios", icon: Hexagon },
  { to: "/sanidad", label: "Sanidad", icon: Shield },
  { to: "/produccion", label: "Producción", icon: Scale },
  { to: "/historico", label: "Histórico", icon: History },
  { to: "/datos", label: "Datos", icon: Archive },
] as const;

function isActive(pathname: string, to: string, exact?: boolean) {
  if (exact || to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { show } = useTutorial();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          <HiveMark className="size-10" />
          <div>
            <p className="font-display text-lg leading-none tracking-tight">mi-apiario</p>
            <p className="mt-1 text-xs text-muted-foreground">Cuaderno de explotación</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              {...item}
              active={isActive(pathname, item.to, "exact" in item && item.exact)}
              layout="side"
            />
          ))}
        </nav>
        <div className="grid gap-2 px-3 pb-5">
          <VoiceFillButton />
          <Button type="button" variant="outline" size="sm" onClick={show}>
            <CircleHelp />
            Guía
          </Button>
          <InstallAppButton size="sm" label="Descargar app" />
          <p className="px-1 text-xs text-muted-foreground">Datos en este dispositivo</p>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-background/95 px-3 backdrop-blur-sm md:hidden">
        <HiveMark className="size-8" />
        <p className="font-display flex-1 text-base tracking-tight">mi-apiario</p>
        <Button type="button" variant="ghost" size="icon" aria-label="Guía" onClick={show}>
          <CircleHelp />
        </Button>
        <InstallAppButton iconOnly variant="ghost" label="Descargar aplicación" />
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pt-5 pb-28 md:pl-[calc(15rem+2rem)] md:pr-8 md:pt-8 md:pb-12">
        {children}
      </main>

      <VoiceFillFab />

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-6">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              {...item}
              active={isActive(pathname, item.to, "exact" in item && item.exact)}
              layout="bottom"
            />
          ))}
        </div>
      </nav>
    </div>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  active,
  layout,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  active: boolean;
  layout: "side" | "bottom";
}) {
  if (layout === "bottom") {
    return (
      <Link
        to={to}
        className={cn(
          "flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
        {label}
      </Link>
    );
  }

  return (
    <Link
      to={to}
      className={cn(
        "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
