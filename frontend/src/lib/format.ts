export function formatClp(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

export function formatPatente(plate: string): string {
  const clean = plate.replace(/[·\s-]/g, "").toUpperCase();
  if (clean.length === 6) {
    return `${clean.slice(0, 2)} · ${clean.slice(2, 4)} · ${clean.slice(4, 6)}`;
  }
  return plate;
}
