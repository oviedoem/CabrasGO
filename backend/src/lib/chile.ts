// Chilean formatting & validation helpers: RUT (with módulo 11 check digit),
// patente (plate), CLP currency, and phone number.

export function computeRutCheckDigit(body: number): string {
  let sum = 0;
  let multiplier = 2;
  let n = body;
  while (n > 0) {
    sum += (n % 10) * multiplier;
    n = Math.floor(n / 10);
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return "0";
  if (remainder === 10) return "K";
  return String(remainder);
}

export function isValidRut(rut: string): boolean {
  const clean = rut.replace(/[.\-\s]/g, "").toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(clean)) return false;
  const body = parseInt(clean.slice(0, -1), 10);
  const dv = clean.slice(-1);
  return computeRutCheckDigit(body) === dv;
}

// Formats "123456789" style raw digits+dv into "12.345.678-9"
export function formatRut(rutRaw: string): string {
  const clean = rutRaw.replace(/[.\-\s]/g, "").toUpperCase();
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const withDots = body
    .split("")
    .reverse()
    .reduce((acc, digit, idx) => {
      return digit + (idx > 0 && idx % 3 === 0 ? "." : "") + acc;
    }, "");
  return `${withDots}-${dv}`;
}

export function makeRut(body: number): string {
  return formatRut(`${body}${computeRutCheckDigit(body)}`);
}

// "LKPX84" -> "LK · PX · 84"
export function formatPatente(plate: string): string {
  const clean = plate.replace(/[·\s-]/g, "").toUpperCase();
  if (clean.length === 6) {
    return `${clean.slice(0, 2)} · ${clean.slice(2, 4)} · ${clean.slice(4, 6)}`;
  }
  return plate;
}

export function formatClp(amount: number): string {
  return `$${Math.round(amount).toLocaleString("es-CL")}`;
}

export function formatPhone(phoneDigits: string): string {
  // expects "9XXXXXXXX"
  const clean = phoneDigits.replace(/\D/g, "").replace(/^56/, "");
  return `+56 9 ${clean.slice(1, 5)} ${clean.slice(5, 9)}`;
}
