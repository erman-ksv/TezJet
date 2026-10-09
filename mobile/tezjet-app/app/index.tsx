import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

const API = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");
const TOKEN = "tezjet_access_token";
type Stop = { id: string; code: string; name: string; sequence: number; position: number };
type Fare = { totalKzt: number; currency: string; distanceStops: number };

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  if (!API) throw new Error("Настрой EXPO_PUBLIC_API_URL — адрес TezJet API.");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API + path, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Ошибка ${response.status}`);
  return data as T;
}

function Button({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.button, disabled && { opacity: 0.45 }]}><Text style={s.buttonText}>{title}</Text></Pressable>;
}

export default function Home() {
  const [mode, setMode] = useState<"passenger" | "driver">("passenger");
  const [token, setToken] = useState("");
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { AsyncStorage.getItem(TOKEN).then(v => v && setToken(v)).catch(() => {}); }, []);
  useEffect(() => {
    if (!token) return;
    request<{stops: Stop[]}>("/api/fares/stops?route_id=pyatak", token).then(r => {
      setStops(r.stops || []);
      if (r.stops?.length > 1) { setA(v => v || r.stops[0].code); setB(v => v || r.stops[1].code); }
    }).catch(e => Alert.alert("Маршрут", e.message));
  }, [token]);
  useEffect(() => {
    if (!token || !a || !b || a === b) { setFare(null); return; }
    request<{fare: Fare}>("/api/fares/estimate", token, { method: "POST", body: JSON.stringify({ route_id: "pyatak", pickup_stop: a, destination_stop: b }) })
      .then(r => setFare(r.fare)).catch(e => { setFare(null); Alert.alert("Стоимость", e.message); });
  }, [token, a, b]);

  async function login(verify: boolean) {
    setBusy(true);
    try {
      const r = await request<{access_token?: string; demo_code?: string}>(verify ? "/api/auth/verify-otp" : "/api/auth/request-otp", undefined, {
        method: "POST",
        body: JSON.stringify({ phone_number: phone.trim(), full_name: name.trim(), code: otp.trim(), role: "passenger", locale: "ru" })
      });
      if (verify && r.access_token) { await AsyncStorage.setItem(TOKEN, r.access_token); setToken(r.access_token); }
      else { setDemoCode(r.demo_code || ""); setRequested(true); }
    } catch (e) { Alert.alert("Авторизация", e instanceof Error ? e.message : "Попробуй ещё раз."); }
    finally { setBusy(false); }
  }

  async function order() {
    const from = stops.find(v => v.code === a), to = stops.find(v => v.code === b);
    if (!from || !to || a === b) return Alert.alert("Маршрут", "Выбери разные точки А и Б.");
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Нужна геолокация", "Для оформления заказа сервер требует координаты точки подачи. Разреши доступ и попробуй снова.");
        return;
      }
      const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: l.coords.latitude, lng: l.coords.longitude, timestamp: l.timestamp, isMocked: false };
      const r = await request<{order: {id: string}; offer?: unknown}>("/api/orders", token, { method: "POST", body: JSON.stringify({
        route_id: "pyatak", pickup_point: from.code, pickup_stop: from.code, destination_stop: to.code,
        pickup_location: coords, pickup_address: address.trim() || from.name, destination: to.name, seats: 1
      }) });
      setMessage(r.offer ? "Заказ отправлен водителю. Ждём подтверждения." : "Заказ создан. Подходящий водитель пока не назначен.");
    } catch (e) { Alert.alert("Заказ", e instanceof Error ? e.message : "Не удалось создать заказ."); }
    finally { setBusy(false); }
  }

  return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={s.header}><Text style={s.logo}>T</Text><View><Text style={s.brand}>tez<Text style={{color:"#0D735C",fontWeight:"900"}}>jet</Text></Text><Text style={s.tag}>ТВОЙ ГОРОД. ТВОЙ МАРШРУТ.</Text></View></View>
    <View style={s.hero}><Text style={s.kicker}>ОДНО ПРИЛОЖЕНИЕ · ANDROID + IOS</Text><Text style={s.title}>{mode === "passenger" ? "Куда едем?" : "TezJet Driver"}</Text><Text style={s.desc}>{mode === "passenger" ? "Выбери маршрут — остальное сделает TezJet." : "Рабочий режим водителя подключим после серверной проверки водительского профиля."}</Text></View>
    <View style={s.switch}><Button title="Пассажир" onPress={() => setMode("passenger")} /><Button title="Водитель" onPress={() => setMode("driver")} /></View>
    {mode === "driver" ? <View style={s.card}><Text style={s.heading}>Режим водителя</Text><Text style={s.descDark}>Пока информационный. Переключение режима не выдаёт водительских прав. Перед реальными заказами проверим серверную авторизацию и правила питаке.</Text></View>
    : !token ? <View style={s.card}><Text style={s.heading}>Вход по телефону</Text><TextInput style={s.input} value={name} onChangeText={setName} placeholder="Твоё имя" /><TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="+998 90 123 45 67" keyboardType="phone-pad" />
      {requested ? <><Text style={s.note}>Тестовый код: {demoCode || "проверь API"}</Text><TextInput style={s.input} value={otp} onChangeText={setOtp} placeholder="Код подтверждения" keyboardType="number-pad" /><Button title={busy ? "Проверяем…" : "Войти"} onPress={() => login(true)} disabled={busy || !otp.trim()} /></> : <Button title={busy ? "Отправляем…" : "Получить код"} onPress={() => login(false)} disabled={busy || !name.trim() || !phone.trim()} />}</View>
    : <View style={s.card}><Text style={s.heading}>Маршрут поездки</Text><Text style={s.label}>ТОЧКА А · ОТПРАВЛЕНИЕ</Text>{stops.map(v => <Pressable key={"a"+v.id} onPress={() => setA(v.code)} style={[s.stop, a===v.code && s.selected]}><Text style={s.stopText}>{v.name}</Text><Text>{v.code}</Text></Pressable>)}<Text style={s.label}>ТОЧКА Б · НАЗНАЧЕНИЕ</Text>{stops.map(v => <Pressable key={"b"+v.id} onPress={() => setB(v.code)} style={[s.stop, b===v.code && s.selected]}><Text style={s.stopText}>{v.name}</Text><Text>{v.code}</Text></Pressable>)}<TextInput style={s.input} value={address} onChangeText={setAddress} placeholder="Уточнение адреса подачи (необязательно)" /><View style={s.fare}><Text style={s.label}>СТОИМОСТЬ</Text><Text style={s.price}>{fare ? new Intl.NumberFormat("ru-RU").format(fare.totalKzt)+" ₸" : "—"}</Text></View><Button title={busy ? "Оформляем…" : "Заказать поездку"} onPress={order} disabled={busy || !fare} />{message ? <Text style={s.note}>{message}</Text> : null}<Text style={s.small}>Геолокация запрашивается только при оформлении заказа.</Text></View>}
    <Text style={s.footer}>TEZJET · ПАССАЖИР И ВОДИТЕЛЬ В ОДНОМ ПРИЛОЖЕНИИ</Text>
  </ScrollView>;
}

const s = StyleSheet.create({
 screen:{flex:1,backgroundColor:"#F3F6F4"},content:{padding:20,paddingTop:24,paddingBottom:44,maxWidth:680,width:"100%",alignSelf:"center"},
 header:{flexDirection:"row",alignItems:"center",gap:12,marginBottom:24},logo:{backgroundColor:"#0C2B26",color:"#fff",fontSize:28,fontWeight:"900",paddingHorizontal:15,paddingVertical:7,borderRadius:14},brand:{fontSize:25,color:"#0C2B26"},tag:{fontSize:9,color:"#6A7D76",letterSpacing:1,fontWeight:"700"},
 hero:{padding:22,backgroundColor:"#0C2B26",borderRadius:24,marginBottom:16},kicker:{fontSize:10,color:"#8ED8BC",fontWeight:"800",letterSpacing:1},title:{fontSize:32,color:"#fff",fontWeight:"900",marginTop:12},desc:{fontSize:14,lineHeight:21,color:"#C5D8D1",marginTop:8},descDark:{fontSize:14,lineHeight:22,color:"#53675E"},
 switch:{flexDirection:"row",gap:8,marginBottom:16},card:{padding:20,backgroundColor:"#fff",borderRadius:24,borderWidth:1,borderColor:"#E5EBE7",marginBottom:16},heading:{fontSize:21,fontWeight:"800",color:"#102D26",marginBottom:16},
 input:{borderWidth:1,borderColor:"#DCE5DF",borderRadius:13,padding:14,color:"#173A30",backgroundColor:"#FBFCFB",marginBottom:12,fontSize:15},button:{flex:1,minHeight:48,borderRadius:14,backgroundColor:"#0D735C",alignItems:"center",justifyContent:"center",paddingHorizontal:12,marginTop:8},buttonText:{color:"#fff",fontSize:14,fontWeight:"800"},
 label:{fontSize:10,fontWeight:"800",letterSpacing:1,color:"#74857D",marginTop:12,marginBottom:8},stop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderWidth:1,borderColor:"#E0E8E3",borderRadius:12,padding:12,marginBottom:7},selected:{borderColor:"#0D735C",backgroundColor:"#EDF8F2"},stopText:{flex:1,color:"#344B41",fontWeight:"600"},fare:{marginTop:12,marginBottom:10,padding:16,backgroundColor:"#F3F8F4",borderRadius:16},price:{fontSize:28,fontWeight:"900",color:"#0D735C"},note:{color:"#175444",backgroundColor:"#E9F8EF",padding:12,borderRadius:10,marginTop:12},small:{fontSize:11,lineHeight:17,color:"#819088",textAlign:"center",marginTop:14},footer:{fontSize:9,fontWeight:"800",letterSpacing:1,color:"#9AA8A1",textAlign:"center",marginTop:12}
});