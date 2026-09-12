import ru from "./ru";

const uz = {
  ...ru,
  otpSent: "Tasdiqlash kodi yuborildi",
  invalidOtp: "Tasdiqlash kodi noto‘g‘ri yoki muddati tugagan",
  profileLocked: "Ro‘yxatdan o‘tgandan keyin ism va telefonni o‘zgartirib bo‘lmaydi",
  outsideGeofence: "Siz navbat nuqtasidan 150 m dan uzoqdasiz",
  fakeGps: "So‘rov rad etildi: soxta GPS aniqlandi",
  tooFast: "So‘rov rad etildi: harakat tezligi 180 km/soatdan yuqori",
  unauthorized: "Avtorizatsiya talab qilinadi",
  driverOnly: "Bu amal faqat haydovchi uchun",
  passengerOnly: "Bu amal faqat yo‘lovchi uchun",
  queueJoined: "Navbatga qo‘shildingiz",
  seatLocked: "Joy 7 daqiqaga band qilindi",
  orderNotFound: "Buyurtma topilmadi",
  invalidStatus: "Holat o‘zgarishiga ruxsat berilmagan",
} as const;

export default uz;