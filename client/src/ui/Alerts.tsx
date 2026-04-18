import { useAppStore } from "../data/store";

export function Alerts() {
  const alerts = useAppStore((s) => s.alerts);
  if (!alerts.length) return null;

  return (
    <div className="alerts">
      {alerts.slice(0, 4).map((a) => {
        const age = Math.floor((Date.now() - a.createdAt) / 1000);
        const ageLabel = age < 60 ? `${age}s sedan` : `${Math.floor(age / 60)}m sedan`;
        return (
          <div key={a.id} className="alert">
            <div><strong>{a.message}</strong> · <span className="station">{a.stationName}</span></div>
            <div className="age">{ageLabel}</div>
          </div>
        );
      })}
    </div>
  );
}
