// Validated GPS landmarks for the VI Región service area (Las Cabras / Lago
// Rapel basin), from "Reporte de Auditoría Técnica y Validación GPS VI Región".

export interface Landmark {
  code: string;
  name: string;
  lat: number;
  lng: number;
  note: string;
}

export const LANDMARKS: Landmark[] = [
  {
    code: "PLAZA_LAS_CABRAS",
    name: "Plaza de Armas de Las Cabras (Centro Cívico)",
    lat: -34.2917,
    lng: -71.3092,
    note: "Pavimentado urbano, alta densidad — punto de partida por defecto",
  },
  {
    code: "MARINA_GOLF_RAPEL",
    name: "Marina Golf Rapel (Sector Bahía)",
    lat: -34.2486,
    lng: -71.4312,
    note: "Camino pavimentado/ripio costero — tarifa dinámica estival x1.35",
  },
  {
    code: "EL_MANZANO",
    name: "El Manzano (Ribera Lago Rapel)",
    lat: -34.225,
    lng: -71.4055,
    note: "Mixto Ruta H-66 y caminos vecinales",
  },
  {
    code: "LLALLAUQUEN",
    name: "Balneario Llallauquén",
    lat: -34.2711,
    lng: -71.4589,
    note: "Camino rural lacustre",
  },
  {
    code: "HOSPITAL_LAS_CABRAS",
    name: "Hospital de Las Cabras",
    lat: -34.2965,
    lng: -71.3148,
    note: "Pavimento urbano — prioridad de despacho asistencial",
  },
  {
    code: "CRUCE_LAS_CABRAS",
    name: "Cruce Las Cabras (Interconexión Colectivos, Ruta H-66)",
    lat: -34.288,
    lng: -71.302,
    note: "Troncal alta afluencia",
  },
  {
    code: "PUNTA_VERDE",
    name: "Punta Verde (Embalse / Camping Rapel)",
    lat: -34.2144,
    lng: -71.482,
    note: "Rural no pavimentado / ripio suelto — requiere 4x4",
  },
  {
    code: "COCALAN",
    name: "Cocalán / Camino Los Silos",
    lat: -34.2052,
    lng: -71.261,
    note: "Agrícola / ruta secundaria",
  },
  {
    code: "CRUCE_PEUMO_SAN_VICENTE",
    name: "Cruce Peumo - San Vicente (H-66 Carretera de la Fruta)",
    lat: -34.331,
    lng: -71.2185,
    note: "Carretera interurbana de alto flujo",
  },
  {
    code: "CERRO_LLALLAUQUEN_REPETIDORA",
    name: "Cerro Llallauquén (Repetidora de Telecomunicaciones)",
    lat: -34.265,
    lng: -71.442,
    note: "Enlace troncal — 99.98% SNR",
  },
];

// Passenger home-screen "quick access" chips per unified spec.
export const QUICK_ACCESS_CODES = [
  "HOSPITAL_LAS_CABRAS",
  "MARINA_GOLF_RAPEL",
  "CRUCE_LAS_CABRAS",
  "EL_MANZANO",
];

export const DEFAULT_PASSENGER_ORIGIN = LANDMARKS[0]; // Plaza de Armas de Las Cabras
