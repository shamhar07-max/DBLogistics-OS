export const LOCALES = ['en', 'ar'] as const; export type Locale = (typeof LOCALES)[number];
export const dir = (l: Locale) => (l === 'ar' ? 'rtl' : 'ltr');
/** Freight-specific wording: say exactly what is waiting on whom ("Awaiting authority response"), never generic "Pending". */
export const messages = {
  en: {
    'status.awaiting_authority': 'Awaiting authority response', 'status.in_transit': 'In transit', 'status.released': 'Released · evidence on file', 'status.hold': 'On hold',
    'status.unbilled': 'Unbilled', 'status.delivered': 'Delivered', 'tracking.actual': 'Actual', 'tracking.estimated': 'Estimated', 'source.carrier': 'Carrier-confirmed', 'source.inferred': 'Estimated',
    'nav.today': 'Today', 'nav.shipments': 'Shipments', 'nav.warehouses': 'Warehouses', 'nav.money': 'Money', 'error.period_closed': 'Select a posting date in an open period.', 'error.separation': 'This action needs a second person.',
  },
  ar: {
    'status.awaiting_authority': 'بانتظار رد الجهة المختصة', 'status.in_transit': 'قيد الشحن', 'status.released': 'تم الإفراج · المستند محفوظ', 'status.hold': 'محجوز',
    'status.unbilled': 'غير مفوتر', 'status.delivered': 'تم التسليم', 'tracking.actual': 'فعلي', 'tracking.estimated': 'تقديري', 'source.carrier': 'مؤكد من الناقل', 'source.inferred': 'تقديري',
    'nav.today': 'اليوم', 'nav.shipments': 'الشحنات', 'nav.warehouses': 'المستودعات', 'nav.money': 'المالية', 'error.period_closed': 'اختر تاريخ ترحيل ضمن فترة مفتوحة.', 'error.separation': 'يتطلب هذا الإجراء شخصاً ثانياً.',
  },
} as const;
export type MessageKey = keyof (typeof messages)['en'];
export const t = (l: Locale, k: MessageKey) => messages[l][k] ?? messages.en[k];
export const fmtMoney = (amount: string, currency: string, l: Locale) => new Intl.NumberFormat(l === 'ar' ? 'ar-AE' : 'en-AE', { style: 'currency', currency }).format(Number(amount));
