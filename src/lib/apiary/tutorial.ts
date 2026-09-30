export const TUTORIAL_KEY = "mi-apiario:tutorial-v4";

export const TUTORIAL_STEPS = [
  {
    title: "Tu cuaderno, en este dispositivo",
    body: "mi-apiario guarda apiarios, colonias, reinas, acciones, sanidad y producción aquí mismo. No hay cuenta ni servidor. Lo que ves es lo que tienes.",
  },
  {
    title: "Apiarios, colmenas y núcleos",
    body: "Un apiario agrupa el patio. Las colmenas y los núcleos se registran por separado, cada uno con su ficha y su historial de acciones habituales.",
  },
  {
    title: "La reina lleva el color del año",
    body: "El marcado sigue el código internacional: el color sale del año de introducción. No se elige a mano. Un cambio de reina queda en el historial.",
  },
  {
    title: "Sanidad, con la varroa delante",
    body: "Cada tratamiento de varroa se anota en la colmena: fecha, producto y nota. En Sanidad también quedan loque, nosema, pollo escayolado, velutina y los muestreos.",
  },
  {
    title: "Producción e histórico",
    body: "Los lotes se anotan en la sala de extracción, no en el número de colmena. El censo de un año cerrado no se inventa a partir de las colmenas de hoy.",
  },
  {
    title: "Modo voz, a manos libres",
    body: "Un toque y el teléfono habla. Di el apiario, el número de colmena y la acción. Confirma con «guarda». Siguiente colmena, «cancela» o «salir». Pensado para el traje y los guantes.",
  },
  {
    title: "Descarga la aplicación",
    body: "Instálala en el teléfono, el iPad o el ordenador. Queda en la pantalla de inicio, funciona sin visor y los datos siguen en el dispositivo. En Datos puedes además guardar un JSON de respaldo.",
  },
] as const;

export function hasSeenTutorial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    /* private mode */
  }
}
