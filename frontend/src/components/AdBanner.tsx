interface Ad {
  id: string;
  title: string;
  bodyText: string;
  imageUrl: string | null;
}

// Simple in-app advertising slot (point 3, "publicidad in-app"): renders
// whichever active campaigns the backend returns for this audience. Not an
// ad network integration — just a banner fed by AdCampaign rows the admin
// manages from the control panel.
export function AdBanner({ ads, dark = false }: { ads: Ad[]; dark?: boolean }) {
  if (!ads.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
      {ads.map((ad) => (
        <div
          key={ad.id}
          className={`flex-shrink-0 w-64 rounded-2xl p-4 shadow-sm ${
            dark ? "bg-cg-darkSurfaceAlt text-cg-darkPrimary" : "bg-cg-surfaceAlt"
          }`}
        >
          <p className="text-[10px] uppercase tracking-wide opacity-50 mb-1">Promocionado</p>
          <p className="font-semibold text-sm mb-1">{ad.title}</p>
          <p className="text-xs opacity-70">{ad.bodyText}</p>
        </div>
      ))}
    </div>
  );
}
