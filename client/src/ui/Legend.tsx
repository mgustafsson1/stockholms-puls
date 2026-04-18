export function Legend() {
  return (
    <div className="legend panel">
      <h4>Teckenförklaring</h4>
      <div className="legend-row"><span className="swatch" style={{ background: "#ff3d4a", color: "#ff3d4a" }} />Röda linjen (T13/T14)</div>
      <div className="legend-row"><span className="swatch" style={{ background: "#4bd582", color: "#4bd582" }} />Gröna linjen (T17/T18/T19)</div>
      <div className="legend-row"><span className="swatch" style={{ background: "#39a7ff", color: "#39a7ff" }} />Blå linjen (T10/T11)</div>
      <div style={{ height: 10 }} />
      <div className="legend-row"><span className="swatch" style={{ background: "#ffffff", color: "#ffffff" }} />Tåg i tid</div>
      <div className="legend-row"><span className="swatch" style={{ background: "#ffc04a", color: "#ffc04a" }} />Försenat</div>
      <div className="legend-row"><span className="swatch" style={{ background: "#ff3030", color: "#ff3030" }} />Stillastående</div>
      <div style={{ height: 10 }} />
      <div style={{ fontSize: 10.5, color: "#8b98ad", lineHeight: 1.4 }}>
        Djup under marknivå ritat i skala 1:80.<br />
        Horisontell skala 1:1000 (1 enhet = 1 km).
      </div>
    </div>
  );
}
