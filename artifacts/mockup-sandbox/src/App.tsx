import { useMemo, useState } from "react";
import { ArrowUp, Car, ChevronDown, Crosshair, MapPin, Menu, Navigation, Search, UserRound, X } from "lucide-react";

type RideState = "idle" | "searching" | "confirmed";

export default function App() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rideState, setRideState] = useState<RideState>("idle");
  const [menuOpen, setMenuOpen] = useState(false);

  const canOrder = Boolean(from.trim() && to.trim());

  const statusText = useMemo(() => {
    if (rideState === "searching") return "Ищем ближайшего водителя…";
    if (rideState === "confirmed") return "Водитель найден";
    return "Куда едем?";
  }, [rideState]);

  function orderRide() {
    if (!canOrder) return;
    setRideState("searching");
    window.setTimeout(() => setRideState("confirmed"), 1600);
  }

  return (
    <main className="tezjet-shell">
      <section className="map-stage" aria-label="Карта TezJet">
        <div className="map-grid" />
        <div className="map-road road-a" />
        <div className="map-road road-b" />
        <div className="map-road road-c" />
        <div className="map-water" />
        <div className="map-label label-a">Центр</div>
        <div className="map-label label-b">Юнусабад</div>
        <div className="map-label label-c">Чиланзар</div>

        <button className="floating-icon menu-button" onClick={() => setMenuOpen((v) => !v)} aria-label="Меню">
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <div className="brand">Tez<span>Jet</span></div>

        <button className="floating-icon locate-button" aria-label="Моё местоположение">
          <Crosshair size={21} />
        </button>

        <div className="route-line" />
        <div className="pin pin-from"><MapPin size={25} /></div>
        <div className="pin pin-to"><Navigation size={23} /></div>

        {rideState === "confirmed" && (
          <div className="driver-card">
            <div className="driver-avatar"><Car size={22} /></div>
            <div>
              <strong>Водитель рядом</strong>
              <span>Белый Chevrolet • 2 мин</span>
            </div>
          </div>
        )}
      </section>

      <section className="booking-sheet">
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">TEZJET</p>
            <h1>{statusText}</h1>
          </div>
          <button className="profile-button" aria-label="Профиль"><UserRound size={19} /></button>
        </div>

        <div className="location-box">
          <div className="location-dot pickup" />
          <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Откуда" aria-label="Откуда" />
          <button className="search-button" aria-label="Выбрать точку подачи"><Search size={18} /></button>
        </div>

        <div className="location-connector" />

        <div className="location-box">
          <div className="location-dot destination" />
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Куда" aria-label="Куда" />
          <button className="search-button" aria-label="Выбрать пункт назначения"><ChevronDown size={18} /></button>
        </div>

        <div className="ride-options">
          <div className="ride-option active">
            <Car size={20} />
            <div><strong>Tez</strong><span>Обычная поездка</span></div>
            <b>от 15 000 сум</b>
          </div>
        </div>

        <button className="order-button" disabled={!canOrder || rideState === "searching"} onClick={orderRide}>
          {rideState === "searching" ? "Поиск водителя…" : rideState === "confirmed" ? "Поездка подтверждена" : "Заказать поездку"}
          {rideState === "idle" && <ArrowUp size={20} />}
        </button>
      </section>
    </main>
  );
}
