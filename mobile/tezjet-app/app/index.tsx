import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { io } from "socket.io-client";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

const API = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");
const TOKEN = "tezjet_access_token";
type Mode = "passenger" | "driver";
type Stop = { id: string; code: string; name: string; sequence: number; position: number };
type Fare = { totalKzt: number; currency: string; distanceStops: number };
type Profile = { id: string; role: string; active_role?: string; driver_approval_status?: "pending" | "approved" | "rejected"; full_name?: string };
type RideOrder = { id: string; status: string; pickup_point: string; pickup_address?: string; destination?: string; seats: number };

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  if (!API) throw new Error("Настрой EXPO_PUBLIC_API_URL — адрес TezJet API.");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API + path, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.message === "string" ? data.message
      : typeof data.error === "string" ? data.error
      : typeof data.error?.message === "string" ? data.error.message
      : `Ошибка ${response.status}`;
    throw new Error(detail);
  }
  return data as T;
}

function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.button, secondary && s.buttonSecondary, disabled && s.disabled]}><Text style={[s.buttonText, secondary && s.buttonSecondaryText]}>{title}</Text></Pressable>;
}

function Stepper({ value, onChange, min = 1, max = 8 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return <View style={s.stepper}><Pressable style={s.stepButton} disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))}><Text style={s.stepText}>−</Text></Pressable><Text style={s.stepValue}>{value}</Text><Pressable style={s.stepButton} disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))}><Text style={s.stepText}>+</Text></Pressable></View>;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("passenger");
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [stops, setStops] = useState<Stop[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [fare, setFare] = useState<Fare | null>(null);
  const [address, setAddress] = useState("");
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [driverSeats, setDriverSeats] = useState(3);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [driverInQueue, setDriverInQueue] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [incomingOrder, setIncomingOrder] = useState<RideOrder | null>(null);
  const [activeOrder, setActiveOrder] = useState<RideOrder | null>(null);

  useEffect(() => { AsyncStorage.getItem(TOKEN).then(v => v && setToken(v)).catch(() => undefined); }, []);

  useEffect(() => {
    if (!token) { setProfile(null); setStops([]); setFare(null); return; }
    let active = true;
    (async () => {
      try {
        const me = await request<{ user: Profile }>("/api/auth/me", token);
        if (!active) return;
        setProfile(me.user);
        const activeRole = me.user.active_role || me.user.role;
        setMode(activeRole === "driver" ? "driver" : "passenger");
        if (activeRole === "passenger") {
          const route = await request<{ stops: Stop[] }>("/api/fares/stops?route_id=pyatak", token);
          if (!active) return;
          const list = route.stops || [];
          setStops(list);
          if (list.length > 1) { setA(v => v || list[0].code); setB(v => v || list[1].code); }
        } else {
          setStops([]);
          setFare(null);
        }
      } catch (e) {
        if (!active) return;
        Alert.alert("Профиль", e instanceof Error ? e.message : "Не удалось загрузить профиль.");
        await AsyncStorage.removeItem(TOKEN);
        setToken("");
        setProfile(null);
      }
    })();
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!token || profile?.active_role !== "passenger" || !a || !b || a === b) { setFare(null); return; }
    let active = true;
    request<{ fare: Fare }>("/api/fares/estimate", token, { method: "POST", body: JSON.stringify({ route_id: "pyatak", pickup_stop: a, destination_stop: b }) })
      .then(r => { if (active) setFare(r.fare); })
      .catch(e => { if (active) { setFare(null); Alert.alert("Стоимость", e instanceof Error ? e.message : "Не удалось рассчитать цену."); } });
    return () => { active = false; };
  }, [token, profile?.active_role, a, b]);

  useEffect(() => {
    if (!token || profile?.active_role !== "driver" || profile.driver_approval_status !== "approved") return;
    let active = true;
    (async () => {
      try {
        const queue = await request<{ your_position: number | null }>("/api/queue", token);
        if (active) { setQueuePosition(queue.your_position); setDriverInQueue(queue.your_position !== null); }
        const orders = await request<{ orders: RideOrder[] }>("/api/orders", token);
        if (active) {
          const current = (orders.orders || []).find(o => !["completed", "cancelled"].includes(o.status));
          setActiveOrder(current || null);
        }
      } catch (e) { if (active) Alert.alert("Водитель", e instanceof Error ? e.message : "Не удалось загрузить данные водителя."); }
    })();
    return () => { active = false; };
  }, [token, profile?.active_role, profile?.driver_approval_status]);

  useEffect(() => {
    if (!token || profile?.active_role !== "driver" || profile.driver_approval_status !== "approved" || !API) return;
    const socket = io(API, { path: "/api/socket.io", auth: { token }, transports: ["websocket"] });
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));
    socket.on("incoming_order", (payload: { order?: RideOrder }) => { if (payload.order) setIncomingOrder(payload.order); });
    socket.on("order:status", (payload: { order?: RideOrder }) => {
      const updatedOrder = payload.order;
      if (!updatedOrder) return;
      setActiveOrder(current => {
        if (current?.id !== updatedOrder.id) return current;
        return ["completed", "cancelled"].includes(updatedOrder.status) ? null : updatedOrder;
      });
    });
    socket.on("queue:position", (payload: { position?: number | null }) => {
      setQueuePosition(payload.position ?? null);
      setDriverInQueue(payload.position != null);
    });
    return () => { socket.disconnect(); setSocketConnected(false); };
  }, [token, profile?.active_role, profile?.driver_approval_status]);

  async function login(verify: boolean) {
    setBusy(true);
    try {
      const r = await request<{ access_token?: string; demo_code?: string }>(verify ? "/api/auth/verify-otp" : "/api/auth/request-otp", undefined, {
        method: "POST",
        body: JSON.stringify({ phone_number: phone.trim(), full_name: name.trim(), code: otp.trim(), role: mode, locale: "ru" })
      });
      if (verify && r.access_token) {
        await AsyncStorage.setItem(TOKEN, r.access_token);
        setRequested(false); setOtp(""); setDemoCode(""); setToken(r.access_token);
      } else { setDemoCode(r.demo_code || ""); setRequested(true); }
    } catch (e) { Alert.alert("Авторизация", e instanceof Error ? e.message : "Попробуй ещё раз."); }
    finally { setBusy(false); }
  }

  async function switchMode(next: Mode) {
    setMode(next);
    setRequested(false); setOtp(""); setDemoCode(""); setMessage("");
    if (token && profile?.active_role !== next) {
      await AsyncStorage.removeItem(TOKEN);
      setToken(""); setProfile(null); setActiveOrder(null); setIncomingOrder(null);
    }
  }

  async function logout() {
    try { if (token) await request<void>("/api/auth/logout", token, { method: "POST" }); } catch { /* clear local session even when offline */ }
    await AsyncStorage.removeItem(TOKEN);
    setToken(""); setProfile(null); setStops([]); setFare(null); setMessage(""); setIncomingOrder(null); setActiveOrder(null);
    setQueuePosition(null); setDriverInQueue(false);
  }

  async function getCoordinates() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error("Разреши доступ к геолокации, чтобы продолжить.");
    const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: l.coords.latitude, lng: l.coords.longitude, timestamp: l.timestamp, isMocked: false };
  }

  async function order() {
    const from = stops.find(v => v.code === a), to = stops.find(v => v.code === b);
    if (!from || !to || a === b) return Alert.alert("Маршрут", "Выбери разные точки А и Б.");
    setBusy(true);
    try {
      const coords = await getCoordinates();
      const r = await request<{ order: RideOrder; offer?: unknown }>("/api/orders", token, { method: "POST", body: JSON.stringify({
        route_id: "pyatak", pickup_point: from.code, pickup_stop: from.code, destination_stop: to.code,
        pickup_location: coords, pickup_address: address.trim() || from.name, destination: to.name, seats
      }) });
      setMessage(r.offer ? "Заказ отправлен подходящему водителю. Ждём подтверждения." : "Заказ создан. Подходящего водителя пока нет; заказ ожидает назначения.");
    } catch (e) { Alert.alert("Заказ", e instanceof Error ? e.message : "Не удалось создать заказ."); }
    finally { setBusy(false); }
  }

  async function refreshProfile() {
    if (!token) return;
    try {
      const me = await request<{ user: Profile }>("/api/auth/me", token);
      setProfile(me.user);
      Alert.alert("Статус профиля", me.user.driver_approval_status === "approved" ? "Водительский профиль подтверждён." : me.user.driver_approval_status === "rejected" ? "Водительский профиль отклонён." : "Профиль ожидает подтверждения администратора.");
    } catch (e) { Alert.alert("Профиль", e instanceof Error ? e.message : "Не удалось обновить статус."); }
  }

  async function joinQueue() {
    setBusy(true);
    try {
      const location = await getCoordinates();
      const result = await request<{ position: number }>("/api/queue/join", token, { method: "POST", body: JSON.stringify({ location, available_seats: driverSeats }) });
      setQueuePosition(result.position); setDriverInQueue(true);
      Alert.alert("TezJet Driver", `Ты в очереди. Позиция: ${result.position}.`);
    } catch (e) { Alert.alert("Не удалось встать в очередь", e instanceof Error ? e.message : "Проверь геолокацию и доступность."); }
    finally { setBusy(false); }
  }

  async function updateDriverLocation() {
    setBusy(true);
    try {
      const location = await getCoordinates();
      await request("/api/queue/location", token, { method: "PATCH", body: JSON.stringify({ location }) });
      Alert.alert("Местоположение обновлено", "Система проверит, к какой точке ты действительно приближаешься.");
    } catch (e) { Alert.alert("Геолокация водителя", e instanceof Error ? e.message : "Не удалось обновить координаты."); }
    finally { setBusy(false); }
  }

  async function leaveQueue() {
    setBusy(true);
    try {
      await request<void>("/api/queue/leave", token, { method: "DELETE" });
      setQueuePosition(null); setDriverInQueue(false);
    } catch (e) { Alert.alert("Очередь", e instanceof Error ? e.message : "Не удалось выйти из очереди."); }
    finally { setBusy(false); }
  }

  async function acceptOrder() {
    if (!incomingOrder) return;
    setBusy(true);
    try {
      const result = await request<{ order: RideOrder }>(`/api/orders/${incomingOrder.id}/accept`, token, { method: "POST" });
      setActiveOrder(result.order); setIncomingOrder(null);
    } catch (e) { Alert.alert("Заказ уже недоступен", e instanceof Error ? e.message : "Обнови данные и попробуй снова."); setIncomingOrder(null); }
    finally { setBusy(false); }
  }

  async function progressOrder() {
    if (!activeOrder) return;
    const next = activeOrder.status === "en_route_to_c" ? "arrived_at_c"
      : activeOrder.status === "arrived_at_c" ? "in_transit"
      : activeOrder.status === "in_transit" ? "completed" : null;
    if (!next) return;
    setBusy(true);
    try {
      const result = await request<{ order: RideOrder }>(`/api/orders/${activeOrder.id}/status`, token, { method: "PATCH", body: JSON.stringify({ status: next }) });
      setActiveOrder(next === "completed" ? null : result.order);
    } catch (e) { Alert.alert("Статус поездки", e instanceof Error ? e.message : "Не удалось обновить поездку."); }
    finally { setBusy(false); }
  }

  const nextStatus = activeOrder?.status === "en_route_to_c" ? "arrived_at_c"
    : activeOrder?.status === "arrived_at_c" ? "in_transit"
    : activeOrder?.status === "in_transit" ? "completed" : null;
  const nextStatusLabel = nextStatus === "arrived_at_c" ? "Я прибыл на точку"
    : nextStatus === "in_transit" ? "Начать поездку"
    : nextStatus === "completed" ? "Завершить поездку" : "";

  return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={s.header}><Text style={s.logo}>T</Text><View style={s.brandWrap}><Text style={s.brand}>tez<Text style={s.brandAccent}>jet</Text></Text><Text style={s.tag}>ТВОЙ ГОРОД. ТВОЙ МАРШРУТ.</Text></View>{token ? <Pressable onPress={logout}><Text style={s.logout}>Выйти</Text></Pressable> : null}</View>
    <View style={s.hero}><Text style={s.kicker}>ОДНО ПРИЛОЖЕНИЕ · ANDROID + IOS</Text><Text style={s.title}>{mode === "passenger" ? "Куда едем?" : "TezJet Driver"}</Text><Text style={s.desc}>{mode === "passenger" ? "Выбери маршрут — остальное сделает TezJet." : "Подтверждённый водитель может встать в очередь и получать подходящие заказы."}</Text></View>
    <View style={s.switch}><Button title="Пассажир" onPress={() => switchMode("passenger")} secondary={mode !== "passenger"} /><Button title="Водитель" onPress={() => switchMode("driver")} secondary={mode !== "driver"} /></View>

    {!token ? <View style={s.card}>
      <Text style={s.heading}>{mode === "driver" ? "Вход или регистрация водителя" : "Вход по телефону"}</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Твоё имя" autoCapitalize="words" />
      <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="+998 90 123 45 67" keyboardType="phone-pad" />
      {requested ? <><Text style={s.note}>Тестовый код: {demoCode || "проверь API"}</Text><TextInput style={s.input} value={otp} onChangeText={setOtp} placeholder="Код подтверждения" keyboardType="number-pad" /><Button title={busy ? "Проверяем…" : mode === "driver" ? "Продолжить как водитель" : "Войти как пассажир"} onPress={() => login(true)} disabled={busy || !otp.trim()} /></> : <Button title={busy ? "Отправляем…" : "Получить код"} onPress={() => login(false)} disabled={busy || !phone.trim() || !name.trim()} />}
      {busy ? <ActivityIndicator style={s.loader} color="#0D735C" /> : null}
      {mode === "driver" ? <Text style={s.small}>Новый водительский профиль будет ожидать подтверждения администратора. До подтверждения заказы недоступны.</Text> : null}
    </View> : mode === "driver" ? (
      profile?.active_role !== "driver" ? <View style={s.card}><Text style={s.heading}>Переключение режима</Text><Text style={s.descDark}>Для смены режима нужно подтвердить вход по номеру телефона.</Text><Button title="Войти в режим водителя" onPress={() => switchMode("driver")} /></View>
      : profile.driver_approval_status !== "approved" ? <View style={s.card}><Text style={s.heading}>{profile.driver_approval_status === "rejected" ? "Профиль отклонён" : "Профиль на проверке"}</Text><Text style={s.descDark}>{profile.driver_approval_status === "rejected" ? "Свяжись с поддержкой TezJet, чтобы узнать причину." : "Администратор должен подтвердить водительский профиль. До этого нельзя вставать в очередь или принимать заказы."}</Text><Button title="Проверить статус" onPress={refreshProfile} secondary /></View>
      : <>
        <View style={s.card}>
          <Text style={s.heading}>Рабочая смена</Text>
          <Text style={s.descDark}>Связь: {socketConnected ? "подключена" : "переподключение…"}</Text>
          <Text style={s.descDark}>Очередь: {driverInQueue ? `позиция ${queuePosition ?? "—"}` : "не в очереди"}</Text>
          <Text style={s.label}>СВОБОДНЫЕ МЕСТА В МАШИНЕ</Text><Stepper value={driverSeats} onChange={setDriverSeats} />
          {!driverInQueue ? <Button title={busy ? "Определяем местоположение…" : "Встать в очередь"} onPress={joinQueue} disabled={busy} /> : <><Button title={busy ? "Обновляем…" : "Обновить местоположение"} onPress={updateDriverLocation} disabled={busy} secondary /><Button title="Выйти из очереди" onPress={leaveQueue} disabled={busy} secondary /></>}
        </View>
        {incomingOrder && !activeOrder ? <View style={s.card}><Text style={s.heading}>Новый заказ</Text><Text style={s.descDark}>Точка подачи: {incomingOrder.pickup_point}</Text><Text style={s.descDark}>Куда: {incomingOrder.destination || "смотри маршрут"}</Text><Text style={s.descDark}>Пассажиров: {incomingOrder.seats}</Text><Button title={busy ? "Принимаем…" : "Принять заказ"} onPress={acceptOrder} disabled={busy} /><Button title="Отклонить" onPress={() => setIncomingOrder(null)} secondary /></View> : null}
        {activeOrder ? <View style={s.card}><Text style={s.heading}>Текущая поездка</Text><Text style={s.descDark}>Статус: {activeOrder.status}</Text><Text style={s.descDark}>Точка подачи: {activeOrder.pickup_point}</Text><Text style={s.descDark}>Назначение: {activeOrder.destination || "по маршруту"}</Text>{nextStatus ? <Button title={busy ? "Обновляем…" : nextStatusLabel} onPress={progressOrder} disabled={busy} /> : null}</View> : null}
        {!incomingOrder && !activeOrder ? <View style={s.card}><Text style={s.descDark}>Ожидаем подходящий заказ. Заказ не будет предложен только потому, что ты стоишь на другом питаке: сервер проверяет расстояние и движение к точке подачи.</Text></View> : null}
      </>
    ) : <View style={s.card}>
      <Text style={s.heading}>Маршрут поездки</Text>
      <Text style={s.label}>ТОЧКА А · ОТПРАВЛЕНИЕ</Text>{stops.map(v => <Pressable key={"a"+v.id} onPress={() => setA(v.code)} style={[s.stop, a===v.code && s.selected]}><Text style={s.stopText}>{v.name}</Text><Text>{v.code}</Text></Pressable>)}
      <Text style={s.label}>ТОЧКА Б · НАЗНАЧЕНИЕ</Text>{stops.map(v => <Pressable key={"b"+v.id} onPress={() => setB(v.code)} style={[s.stop, b===v.code && s.selected]}><Text style={s.stopText}>{v.name}</Text><Text>{v.code}</Text></Pressable>)}
      <TextInput style={s.input} value={address} onChangeText={setAddress} placeholder="Уточнение адреса подачи (необязательно)" />
      <View style={s.fare}><Text style={s.label}>ПРЕДВАРИТЕЛЬНАЯ СТОИМОСТЬ</Text><Text style={s.price}>{fare ? new Intl.NumberFormat("ru-RU").format(fare.totalKzt)+" ₸" : "—"}</Text></View>
      <View style={s.seatsRow}><Text style={s.descDark}>Пассажиры (до 8)</Text><Stepper value={seats} onChange={setSeats} /></View>
      <Button title={busy ? "Оформляем…" : "Заказать поездку"} onPress={order} disabled={busy || !fare} />
      {message ? <Text style={s.note}>{message}</Text> : null}<Text style={s.small}>Геолокация запрашивается только при оформлении заказа.</Text>
    </View>}
    <Text style={s.footer}>TEZJET · ПАССАЖИР И ВОДИТЕЛЬ В ОДНОМ ПРИЛОЖЕНИИ</Text>
  </ScrollView>;
}

const s = StyleSheet.create({
 screen:{flex:1,backgroundColor:"#F3F6F4"},content:{padding:20,paddingTop:24,paddingBottom:44,maxWidth:680,width:"100%",alignSelf:"center"},
 header:{flexDirection:"row",alignItems:"center",gap:12,marginBottom:24},logo:{backgroundColor:"#0C2B26",color:"#fff",fontSize:28,fontWeight:"900",paddingHorizontal:15,paddingVertical:7,borderRadius:14},brandWrap:{flex:1},brand:{fontSize:25,color:"#0C2B26"},brandAccent:{color:"#0D735C",fontWeight:"900"},tag:{fontSize:9,color:"#6A7D76",letterSpacing:1,fontWeight:"700"},logout:{padding:8,color:"#5A6B65",fontWeight:"700"},
 hero:{padding:22,backgroundColor:"#0C2B26",borderRadius:24,marginBottom:16},kicker:{fontSize:10,color:"#8ED8BC",fontWeight:"800",letterSpacing:1},title:{fontSize:32,color:"#fff",fontWeight:"900",marginTop:12},desc:{fontSize:14,lineHeight:21,color:"#C5D8D1",marginTop:8},descDark:{fontSize:14,lineHeight:22,color:"#53675E"},
 switch:{flexDirection:"row",gap:8,marginBottom:16},card:{padding:20,backgroundColor:"#fff",borderRadius:24,borderWidth:1,borderColor:"#E5EBE7",marginBottom:16},heading:{fontSize:21,fontWeight:"800",color:"#102D26",marginBottom:16},
 input:{borderWidth:1,borderColor:"#DCE5DF",borderRadius:13,padding:14,color:"#173A30",backgroundColor:"#FBFCFB",marginBottom:12,fontSize:15},button:{flex:1,minHeight:48,borderRadius:14,backgroundColor:"#0D735C",alignItems:"center",justifyContent:"center",paddingHorizontal:12,marginTop:8},buttonSecondary:{backgroundColor:"#F0F5F2",borderWidth:1,borderColor:"#DCE8E1"},disabled:{opacity:0.45},buttonText:{color:"#fff",fontSize:14,fontWeight:"800"},buttonSecondaryText:{color:"#175444"},
 label:{fontSize:10,fontWeight:"800",letterSpacing:1,color:"#74857D",marginTop:12,marginBottom:8},stop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderWidth:1,borderColor:"#E0E8E3",borderRadius:12,padding:12,marginBottom:7},selected:{borderColor:"#0D735C",backgroundColor:"#EDF8F2"},stopText:{flex:1,color:"#344B41",fontWeight:"600"},fare:{marginTop:12,marginBottom:10,padding:16,backgroundColor:"#F3F8F4",borderRadius:16},price:{fontSize:28,fontWeight:"900",color:"#0D735C"},
 note:{color:"#175444",backgroundColor:"#E9F8EF",padding:12,borderRadius:10,marginTop:12},small:{fontSize:11,lineHeight:17,color:"#819088",textAlign:"center",marginTop:14},footer:{fontSize:9,fontWeight:"800",letterSpacing:1,color:"#9AA8A1",textAlign:"center",marginTop:12},
 stepper:{flexDirection:"row",alignItems:"center",gap:16},stepButton:{width:34,height:34,borderRadius:10,backgroundColor:"#E9F3ED",alignItems:"center",justifyContent:"center"},stepText:{fontSize:22,color:"#0D735C",fontWeight:"700"},stepValue:{minWidth:20,textAlign:"center",fontSize:16,color:"#102D26",fontWeight:"800"},seatsRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:8},loader:{marginTop:12}
});