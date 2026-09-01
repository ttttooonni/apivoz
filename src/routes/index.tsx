import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ApiaryFormDialog } from "@/components/apiary/apiary-form";
import { EmptyState } from "@/components/apiary/empty-state";
import { InstallAppButton } from "@/components/apiary/install-app";
import { StatCard } from "@/components/apiary/stat-card";
import { useTutorial } from "@/components/apiary/tutorial";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  coloniesMissingVarroa,
  currentYear,
  formatKg,
  hiveCount,
  honeyThisYear,
  newId,
  nowIso,
  nucCount,
  PRODUCT_LABEL,
  PRODUCT_ORDER,
  productionOfYear,
  useAppMutations,
  useNotebook,
  varroaTreatedIds,
} from "@/lib/apiary";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { data, error } = useNotebook();
  const { saveApiary, loadSample } = useAppMutations();
  const { show } = useTutorial();
  const [createOpen, setCreateOpen] = useState(false);
  const year = currentYear();

  if (error) {
    return (
      <EmptyState
        title="No se pueden leer los datos"
        description={error.message}
      />
    );
  }

  const empty = data.apiaries.length === 0;
  const products = productionOfYear(data.production, year);
  const treated = varroaTreatedIds(data, year);
  const pendingVarroa = coloniesMissingVarroa(data, year);

  return (
    <div>
      <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
        Temporada {year}
      </p>
      <h1 className="mt-1 font-display text-3xl font-medium tracking-tight">Inicio</h1>
      <p className="mt-1 mb-6 max-w-xl text-sm text-muted-foreground">
        Cuaderno de explotación. Lo importante, a mano. También puedes dictar el asiento.
      </p>

      {empty ? (
        <EmptyState
          title="Todavía no hay apiarios"
          description="Crea el primero o carga un ejemplo. La guía explica cómo está organizado el cuaderno."
          actions={
            <>
              <Button onClick={() => setCreateOpen(true)}>Crear apiario</Button>
              <Button
                variant="outline"
                disabled={loadSample.isPending}
                onClick={() => {
                  void loadSample
                    .mutateAsync()
                    .then(() => toast.success("Ejemplo cargado"))
                    .catch((err: unknown) =>
                      toast.error(err instanceof Error ? err.message : "No se pudo cargar"),
                    );
                }}
              >
                {loadSample.isPending ? "Cargando…" : "Cargar ejemplo"}
              </Button>
              <Button variant="ghost" onClick={show}>
                Ver guía
              </Button>
            </>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Apiarios" value={data.apiaries.length} />
            <StatCard label="Colmenas" value={hiveCount(data)} />
            <StatCard label="Núcleos" value={nucCount(data)} />
            <StatCard label={`Miel ${year}`} value={formatKg(honeyThisYear(data))} />
          </div>

          <Card className="mt-4 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-lg font-medium">Sanidad {year}</h2>
              <Link to="/sanidad" className="text-sm text-primary hover:underline">
                Abrir
              </Link>
            </div>
            <p className="mt-3 text-sm">
              Varroa: {treated.size} de {data.colonies.length} colonias con tratamiento.
              {pendingVarroa.length > 0
                ? ` Pendientes: ${pendingVarroa
                    .slice(0, 4)
                    .map((item) => item.number)
                    .join(", ")}${pendingVarroa.length > 4 ? "…" : ""}.`
                : " Ninguna pendiente."}
            </p>
          </Card>

          <Card className="mt-4 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-lg font-medium">Producción {year}</h2>
              <Link to="/produccion" className="text-sm text-primary hover:underline">
                Registrar
              </Link>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
              {PRODUCT_ORDER.map((product) => (
                <div key={product}>
                  <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                    {PRODUCT_LABEL[product]}
                  </dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {products[product] > 0 ? formatKg(products[product]) : "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setCreateOpen(true)}>Nuevo apiario</Button>
            <Button variant="outline" asChild>
              <Link to="/apiarios">Ver apiarios</Link>
            </Button>
            <InstallAppButton variant="outline" label="Descargar aplicación" />
          </div>
        </>
      )}

      <ApiaryFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={async (values) => {
          await saveApiary.mutateAsync({
            id: newId(),
            ...values,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          });
          toast.success("Apiario creado");
        }}
      />
    </div>
  );
}
