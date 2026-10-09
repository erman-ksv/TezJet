import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CarFront,
  CheckCircle2,
  ChevronDown,
  Crosshair,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

type RideState = "idle" | "submitting" | "created" | "error";
type RouteStop = { id: string; code: string; name: string; sequence: number; position: number };
type Fare = { totalKzt: number; currency: string; distanceStops: number };
type ApiError = { error?: string; message?: string; details?: string };

const TOKEN_KEY = "tezjet_access_token";
const ROUTE_ID = "pyatak";

async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    const detail = body.message || body.error || body.details;
    throw new Error(detail || `Запрос не выполнен (${response.status})`);
  }
  return body;
}

function getBrowserLocation(): Promise<{ lat: number; lng: number; timestamp: number; isMocked: false }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Этот браузер не поддерживает геолокацию."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => resolve({
        lat: coords.latitude,
        lng: coords.longitude,
        timestamp: timestamp || Date.now(),
        isMocked: false,
      }),
      (error) => reject(new Error(
        error.code === error.PERMISSION_DENIED
          ? "Разреши доступ к геолокации, чтобы оформить заказ."
          : "Не удалось определить местоположение. Попробуй ещё раз.",
      )),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [userName, setUserName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [pickupCode, setPickupCode] = useState("");
  const [destinationCode, setDestinationCode] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [seats, setSeats] = useState(1);
  const [fare, setFare] = useState<Fare | null>(null);
  const [fareBusy, setFareBusy] = useState(false);
  const [rideState, setRideState] = useState<RideState>("idle");
  const [rideMessage, setRideMessage] = useState("");
  const [rideError, setRideError] = useState("");
  const [orderId, setOrderId] = useState("");

  const pickup = stops.find((stop) => stop.code === pickupCode);
  const destination = stops.find((stop) => stop.code === destinationCode);
  const canEstimate = Boolean(token && pickupCode && destinationCode && pickupCode !== destinationCode);
  const statusTitle = useMemo(() => {
    if (rideState === "submitting") return "Оформляем поездку";
    if (rideState === "created") return "Заказ создан";
    return "Куда едем?";
  }, [rideState]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { fullName?: string; full_name?: string } }>("/api/auth/me", token);
        if (cancelled) return;
        setUserName(me.user.fullName || me.user.full_name || "");
        const route = await api<{ stops: RouteStop[] }>("/api/fares/stops?route_id=" + ROUTE_ID, token);
        if (cancelled) return;
        setStops(route.stops ?? []);
        if (route.stops?.length) {
          setPickupCode((current) => current || route.stops[0].code);
          setDestinationCode((current) => current || route.stops[Math.min(1, route.stops.length - 1)].code);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Не удалось загрузить профиль.";
        if (/401|unauthorized|token/i.test(message)) {
          localStorage.removeItem(TOKEN_KEY);
          setToken("");
        } else {
          setRideError(message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!canEstimate) {
      setFare(null);
      return;
    }
    let cancelled = false;
    setFareBusy(true);
    api<{ fare: Fare }>("/api/fares/estimate", token, {
      method: "POST",
      body: JSON.stringify({
        route_id: ROUTE_ID,
        pickup_stop: pickupCode,
        destination_stop: destinationCode,
      }),
    })
      .then((result) => { if (!cancelled) setFare(result.fare); })
      .catch((error) => {
        if (!cancelled) {
          setFare(null);
          setRideError(error instanceof Error ? error.message : "Не удалось рассчитать стоимость.");
        }
      })
      .finally(() => { if (!cancelled) setFareBusy(false); });
    return () => { cancelled = true; };
  }, [canEstimate, token, pickupCode, destinationCode]);

  async function requestOtp() {
    setAuthBusy(true);
    setAuthError("");
    setDemoCode("");
    try {
      const result = await api<{ demo_code?: string }>("/api/auth/request-otp", undefined, {
        method: "POST",
        body: JSON.stringify({
          phone_number: phone.trim(),
          full_name: userName.trim(),
          role: "passenger",
          locale: "ru",
        }),
      });
      setOtpRequested(true);
      setDemoCode(result.demo_code ?? "");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не удалось запросить код.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function verifyOtp() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const result = await api<{ access_token: string; user?: { fullName?: string; full_name?: string } }>(
        "/api/auth/verify-otp",
        undefined,
        {
          method: "POST",
          body: JSON.stringify({
            phone_number: phone.trim(),
            code: otp.trim(),
            full_name: userName.trim(),
            role: "passenger",
            locale: "ru",
          }),
        },
      );
      localStorage.setItem(TOKEN_KEY, result.access_token);
      setToken(result.access_token);
      setUserName(result.user?.fullName || result.user?.full_name || userName.trim());
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не удалось войти.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try { await api<void>("/api/auth/logout", token, { method: "POST" }); } catch { /* local logout still works */ }
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setStops([]);
    setFare(null);
    setRideState("idle");
    setRideMessage("");
    setOrderId("");
    setMenuOpen(false);
  }

  async function orderRide() {
    if (!token || !pickup || !destination || pickup.code === destination.code) {
      setRideError("Выбери разные точки отправления и назначения.");
      return;
    }
    setRideState("submitting");
    setRideError("");
    setRideMessage("");
    try {
      const location = await getBrowserLocation();
      const result = await api<{ order: { id: string; status: string }; offer: unknown }>(
        "/api/orders",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            route_id: ROUTE_ID,
            pickup_point: "C",
            pickup_stop: pickup.code,
            destination_stop: destination.code,
            pickup_location: location,
            pickup_address: pickupAddress.trim() || pickup.name,
            destination: destination.name,
            seats,
          }),
        },
      );
      setOrderId(result.order.id);
      setRideState("created");
      setRideMessage(
        result.offer
          ? "Заказ отправлен водителю. Ожидаем подтверждение."
          : "Заказ создан. Сейчас свободного водителя нет — заказ ожидает назначения.",
      );
    } catch (error) {
      setRideState("error");
      setRideError(error instanceof Error ? error.message : "Не удалось создать заказ.");
    }
  }

  return (
    <main className="tezjet-shell">
      <section className="map-stage" aria-label="Схема маршрута TezJet">
        <div className="map-glow" />
        <div className="map-grid" />
        <div className="map-park park-one" />
        <div className="map-park park-two" />
        <div className="map-road road-a" />
        <div className="map-road road-b" />
        <div className="map-road road-c" />
        <div className="map-road road-d" />
        <div className="map-label label-a">ГОРОД</div>
        <div className="map-label label-b">ВАШ МАРШРУТ</div>
        <div className="route-line"><span /></div>
        <div className="map-pin pin-from"><MapPin size={21} /></div>
        <div className="map-pin pin-to"><Navigation size={19} /></div>
        <button className="floating-icon menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Открыть меню">
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <div className="brand" aria-label="TezJet"><span className="brand-mark">T</span><span>tez</span><b>jet</b></div>
        <div className="map-caption"><span className="live-dot" /> ПЛАНИРОВАНИЕ ПОЕЗДКИ</div>
        <button className="floating-icon locate-button" onClick={() => {
          getBrowserLocation()
            .then(() => setRideError("Местоположение определено. Оно будет использовано при оформлении заказа."))
            .catch((error) => setRideError(error instanceof Error ? error.message : "Геолокация недоступна."));
        }} aria-label="Определить местоположение">
          <Crosshair size={20} />
        </button>
        {menuOpen && (
          <div className="menu-popover">
            <div className="menu-user"><span className="menu-avatar"><UserRound size={18} /></span><div><strong>{userName || "Пассажир"}</strong><small>{phone || "Аккаунт TezJet"}</small></div></div>
            {token && <button onClick={logout}><LogOut size={16} /> Выйти из аккаунта</button>}
          </div>
        )}
      </section>

      <section className="booking-sheet">
        <div className="sheet-handle" />
        <header className="sheet-heading">
          <div><p className="eyebrow">TEZJET PASSENGER</p><h1>{statusTitle}</h1><p className="subheading">Спокойно. Удобно. По твоему маршруту.</p></div>
          <div className="trust-icon"><ShieldCheck size={21} /></div>
        </header>

        {!token ? (
          <div className="auth-box">
            <div className="section-label"><span className="section-number">01</span><strong>Вход по номеру телефона</strong></div>
            {!otpRequested ? (
              <>
                <label className="field-label">Как к тебе обращаться<input value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="Имя" autoComplete="name" /></label>
                <label className="field-label">Номер телефона<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+998 90 123 45 67" inputMode="tel" autoComplete="tel" /></label>
                <button className="primary-button" onClick={requestOtp} disabled={authBusy || !phone.trim() || !userName.trim()}>{authBusy ? <LoaderCircle className="spin" size={18} /> : null}{authBusy ? "Отправляем код…" : "Получить код"}<ArrowUpRight size={18} /></button>
              </>
            ) : (
              <>
                <p className="hint-text">Введи код подтверждения для {phone}.</p>
                {demoCode && <div className="demo-code">Тестовый код: <strong>{demoCode}</strong></div>}
                <label className="field-label">Код подтверждения<input value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="6 цифр" inputMode="numeric" autoComplete="one-time-code" /></label>
                <button className="primary-button" onClick={verifyOtp} disabled={authBusy || !otp.trim()}>{authBusy ? <LoaderCircle className="spin" size={18} /> : null}{authBusy ? "Проверяем…" : "Войти в TezJet"}<ArrowUpRight size={18} /></button>
                <button className="text-button" onClick={() => { setOtpRequested(false); setOtp(""); setDemoCode(""); }}>Изменить номер</button>
              </>
            )}
            {authError && <p className="error-message">{authError}</p>}
          </div>
        ) : (
          <>
            <div className="section-label"><span className="section-number">01</span><strong>Маршрут поездки</strong><span className="section-meta">А → Б</span></div>
            <div className="location-stack">
              <label className="location-field"><span className="location-dot pickup-dot" /><span className="field-content"><small>ТОЧКА ОТПРАВЛЕНИЯ</small><select value={pickupCode} onChange={(event) => setPickupCode(event.target.value)} disabled={!stops.length}><option value="">Выбери точку А</option>{stops.map((stop) => <option key={stop.id} value={stop.code}>{stop.name}</option>)}</select></span><ChevronDown size={17} /></label>
              <div className="field-connector" />
              <label className="location-field"><span className="location-dot destination-dot" /><span className="field-content"><small>ПУНКТ НАЗНАЧЕНИЯ</small><select value={destinationCode} onChange={(event) => setDestinationCode(event.target.value)} disabled={!stops.length}><option value="">Выбери точку Б</option>{stops.map((stop) => <option key={stop.id} value={stop.code}>{stop.name}</option>)}</select></span><ChevronDown size={17} /></label>
            </div>
            <label className="field-label pickup-address-label">Уточнение адреса подачи <input value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} placeholder={pickup?.name || "Например, возле главного входа"} /></label>

            <div className="ride-details">
              <div className="ride-type"><span className="car-icon"><CarFront size={23} /></span><span><strong>Tez</strong><small>Стандартная поездка</small></span></div>
              <label className="seats-select"><span>Пассажиры</span><select value={seats} onChange={(event) => setSeats(Number(event.target.value))}>{[1,2,3,4,5,6,7,8].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
            </div>

            <div className="fare-row"><span><small>СТОИМОСТЬ ПО МАРШРУТУ</small><strong>{fareBusy ? "Считаем…" : fare ? new Intl.NumberFormat("ru-RU").format(fare.totalKzt) + " ₸" : "—"}</strong></span><span className="fare-note">{fare ? "Расчёт по остановкам" : "Выбери точки А и Б"}</span></div>

            {rideState === "created" && <div className="success-panel"><CheckCircle2 size={20} /><div><strong>Заказ {orderId ? "#" + orderId.slice(0, 8) : "создан"}</strong><p>{rideMessage}</p></div></div>}
            {(rideError || (rideState === "error" && !rideError)) && <p className="error-message">{rideError || "Не удалось создать заказ."}</p>}
            <button className="primary-button order-button" onClick={orderRide} disabled={!canEstimate || !fare || fareBusy || rideState === "submitting" || rideState === "created"}>
              {rideState === "submitting" ? <LoaderCircle className="spin" size={18} /> : null}
              {rideState === "submitting" ? "Создаём заказ…" : rideState === "created" ? "Заказ оформлен" : "Заказать поездку"}
              {rideState !== "submitting" && rideState !== "created" ? <ArrowUpRight size={19} /> : null}
            </button>
            <p className="privacy-note"><ShieldCheck size={14} /> Геолокация запрашивается только по твоему действию.</p>
          </>
        )}
        <footer className="sheet-footer"><span>TEZJET</span><span>ТВОЙ ГОРОД. ТВОЙ МАРШРУТ.</span></footer>
      </section>
    </main>
  );
}
