// Real map tiles via OpenStreetMap (no API key required — unlike Google Maps).
import { MapContainer, TileLayer, Marker, Popup, Polygon } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default marker icons reference image files that Vite doesn't
// resolve automatically; rebuild them from the CDN so pins render correctly.
const defaultIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const carIcon = new L.DivIcon({
  html: '<div style="background:#10B981;border-radius:50%;width:16px;height:16px;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  className: "",
  iconSize: [16, 16],
});

export interface MapMarkerPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sub?: string;
  kind?: "car" | "pin";
}

export function LiveMap({
  center,
  markers = [],
  polygons = [],
  height = 220,
  zoom = 13,
}: {
  center: [number, number];
  markers?: MapMarkerPoint[];
  polygons?: { id: string; positions: [number, number][]; color?: string }[];
  height?: number;
  zoom?: number;
}) {
  return (
    <div style={{ height }} className="rounded-2xl overflow-hidden">
      <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {polygons.map((p) => (
          <Polygon key={p.id} positions={p.positions} pathOptions={{ color: p.color ?? "#10B981", fillOpacity: 0.15 }} />
        ))}
        {markers.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={m.kind === "car" ? carIcon : defaultIcon}>
            <Popup>
              <b>{m.label}</b>
              {m.sub ? <div>{m.sub}</div> : null}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
