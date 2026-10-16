// Display currency: guess the viewer's country (time zone first, then browser language),
// list every currency with the countries that use it, and format USD costs in the chosen one.

// ISO 3166 region -> ISO 4217 currency.
const REGION_CURRENCY = Object.fromEntries(`AD:EUR AE:AED AF:AFN AG:XCD AI:XCD AL:ALL AM:AMD AO:AOA AR:ARS AS:USD AT:EUR AU:AUD AW:AWG AX:EUR AZ:AZN
BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF BG:BGN BH:BHD BI:BIF BJ:XOF BL:EUR BM:BMD BN:BND BO:BOB BQ:USD BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD
CA:CAD CC:AUD CD:CDF CF:XAF CG:XAF CH:CHF CI:XOF CK:NZD CL:CLP CM:XAF CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CW:ANG CX:AUD CY:EUR CZ:CZK
DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD EC:USD EE:EUR EG:EGP EH:MAD ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FK:FKP FM:USD FO:DKK FR:EUR
GA:XAF GB:GBP GD:XCD GE:GEL GF:EUR GG:GBP GH:GHS GI:GIP GL:DKK GM:GMD GN:GNF GP:EUR GQ:XAF GR:EUR GT:GTQ GU:USD GW:XOF GY:GYD
HK:HKD HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IM:GBP IN:INR IO:USD IQ:IQD IR:IRR IS:ISK IT:EUR JE:GBP JM:JMD JO:JOD JP:JPY
KE:KES KG:KGS KH:KHR KI:AUD KM:KMF KN:XCD KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP LC:XCD LI:CHF LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD
MA:MAD MC:EUR MD:MDL ME:EUR MF:EUR MG:MGA MH:USD MK:MKD ML:XOF MM:MMK MN:MNT MO:MOP MP:USD MQ:EUR MR:MRU MS:XCD MT:EUR MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN
NA:NAD NC:XPF NE:XOF NF:AUD NG:NGN NI:NIO NL:EUR NO:NOK NP:NPR NR:AUD NU:NZD NZ:NZD OM:OMR PA:PAB PE:PEN PF:XPF PG:PGK PH:PHP PK:PKR PL:PLN PM:EUR PN:NZD PR:USD PS:ILS PT:EUR PW:USD PY:PYG
QA:QAR RE:EUR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SI:EUR SK:EUR SL:SLE SM:EUR SN:XOF SO:SOS SR:SRD SS:SSP ST:STN SV:USD SX:ANG SY:SYP SZ:SZL
TC:USD TD:XAF TG:XOF TH:THB TJ:TJS TK:NZD TL:USD TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TV:AUD TW:TWD TZ:TZS UA:UAH UG:UGX US:USD UY:UYU UZ:UZS
VA:EUR VC:XCD VE:VES VG:USD VI:USD VN:VND VU:VUV WF:XPF WS:WST XK:EUR YE:YER YT:EUR ZA:ZAR ZM:ZMW ZW:ZWG`.split(/\s+/).map((p) => p.split(':')));

// Common time zones -> region; the time zone says where the viewer is more often than the language does.
const ZONE_REGION = {
  'Asia/Manila': 'PH', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW', 'Asia/Shanghai': 'CN', 'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK',
  'Asia/Kathmandu': 'NP', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Jerusalem': 'IL',
  'Asia/Tehran': 'IR', 'Asia/Almaty': 'KZ', 'Asia/Tashkent': 'UZ', 'Europe/Istanbul': 'TR', 'Europe/London': 'GB', 'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO', 'Europe/Athens': 'GR', 'Europe/Lisbon': 'PT',
  'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', 'Europe/Moscow': 'RU', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA', 'Africa/Casablanca': 'MA', 'Africa/Accra': 'GH', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Pacific/Auckland': 'NZ', 'America/Toronto': 'CA',
  'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Buenos_Aires': 'AR', 'America/Santiago': 'CL', 'America/Bogota': 'CO',
  'America/Lima': 'PE', 'America/Caracas': 'VE', 'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Phoenix': 'US', 'America/Los_Angeles': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Puerto_Rico': 'PR',
};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });

export function detectRegion() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (ZONE_REGION[zone]) return ZONE_REGION[zone];
  } catch { /* old browser */ }
  for (const lang of navigator.languages || [navigator.language]) {
    try { const r = new Intl.Locale(lang).maximize().region; if (r && REGION_CURRENCY[r]) return r; } catch { /* bad tag */ }
  }
  return 'US';
}

// One entry per currency we have a rate for: { code, name, countries[] }.
export function currencyList(rates) {
  const byCode = new Map();
  for (const [region, code] of Object.entries(REGION_CURRENCY)) {
    if (!rates[code]) continue;
    if (!byCode.has(code)) byCode.set(code, { code, name: safe(() => currencyNames.of(code), code), countries: [] });
    const list = byCode.get(code).countries, name = safe(() => regionNames.of(region), region);
    if (code.startsWith(region)) list.unshift(name); else list.push(name); // USD lists the United States first
  }
  for (const code of Object.keys(rates)) if (!byCode.has(code)) byCode.set(code, { code, name: safe(() => currencyNames.of(code), code), countries: [] });
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export const regionCurrency = (region) => REGION_CURRENCY[region] || 'USD';
export const regionName = (region) => safe(() => regionNames.of(region), region);
const safe = (fn, fallback) => { try { return fn() || fallback; } catch { return fallback; } };

// USD amount -> short string in the chosen currency. Large values switch to compact (1.2K, 3.4M).
const fmtCache = new Map();
export function formatMoney(usdAmount, code, rate) {
  const v = usdAmount * rate;
  const a = Math.abs(v);
  const key = `${code}|${a >= 1e4 ? 'c' : a >= 100 ? 0 : 2}`;
  if (!fmtCache.has(key)) {
    const opts = { style: 'currency', currency: code, currencyDisplay: 'symbol' };
    if (a >= 1e4) Object.assign(opts, { notation: 'compact', maximumFractionDigits: 1 });
    else if (a >= 100) Object.assign(opts, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    fmtCache.set(key, new Intl.NumberFormat(undefined, opts));
  }
  return fmtCache.get(key).format(v);
}
