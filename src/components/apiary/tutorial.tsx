import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BookOpen, CircleDot, Download, Hexagon, Mic, Scale, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hasSeenTutorial, markTutorialSeen, TUTORIAL_STEPS } from "@/lib/apiary/tutorial";
import { useInstallApp } from "./install-app";
import { cn } from "@/lib/utils";

const ICONS = [BookOpen, Hexagon, CircleDot, Shield, Scale, Mic, Download] as const;

type TutorialContextValue = {
  show: () => void;
};

const TutorialContext = createContext<TutorialContextValue>({ show: () => {} });

export function useTutorial() {
  return useContext(TutorialContext);
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!hasSeenTutorial()) setOpen(true);
  }, []);

  const show = useCallback(() => {
    setStep(0);
    setOpen(true);
  }, []);

  const close = useCallback((nextOpen: boolean) => {
    if (!nextOpen) markTutorialSeen();
    setOpen(nextOpen);
    if (!nextOpen) setStep(0);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      <TutorialDialog open={open} step={step} setStep={setStep} onOpenChange={close} />
    </TutorialContext.Provider>
  );
}

function TutorialDialog({
  open,
  step,
  setStep,
  onOpenChange,
}: {
  open: boolean;
  step: number;
  setStep: (n: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { show: showInstall, installed } = useInstallApp();
  const total = TUTORIAL_STEPS.length;
  const current = TUTORIAL_STEPS[step];
  const Icon = ICONS[step] ?? BookOpen;
  const last = step === total - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Guía · {step + 1} de {total}
          </p>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-primary">
              <Icon className="size-4" strokeWidth={1.8} />
            </span>
            {current.title}
          </DialogTitle>
          <DialogDescription>{current.body}</DialogDescription>
        </DialogHeader>

        <ol className="flex gap-1.5" aria-hidden="true">
          {TUTORIAL_STEPS.map((item, index) => (
            <li
              key={item.title}
              className={cn(
                "h-1 flex-1 rounded-full",
                index <= step ? "bg-primary" : "bg-secondary",
              )}
            />
          ))}
        </ol>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="sm:mr-auto"
          >
            Saltar
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {step > 0 ? (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                Anterior
              </Button>
            ) : null}
            {last ? (
              <>
                {installed ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onOpenChange(false);
                      window.setTimeout(() => showInstall(), 180);
                    }}
                  >
                    <Download />
                    Descargar aplicación
                  </Button>
                )}
                <Button type="button" onClick={() => onOpenChange(false)}>
                  Entendido
                </Button>
              </>
            ) : (
              <Button type="button" onClick={() => setStep(step + 1)}>
                Siguiente
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
