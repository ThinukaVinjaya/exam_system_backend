export interface ProvinceData {
  id: string;
  nameEn: string;
  nameSi: string;
}

export interface DistrictData {
  id: string;
  provinceId: string;
  nameEn: string;
  nameSi: string;
}

export const PROVINCES: ProvinceData[] = [
  { id: 'western', nameEn: 'Western Province', nameSi: 'බස්නාහිර පළාත' },
  { id: 'central', nameEn: 'Central Province', nameSi: 'මධ්‍යම පළාත' },
  { id: 'southern', nameEn: 'Southern Province', nameSi: 'දකුණු පළාත' },
  { id: 'northern', nameEn: 'Northern Province', nameSi: 'උතුරු පළාත' },
  { id: 'eastern', nameEn: 'Eastern Province', nameSi: 'නැගෙනහිර පළාත' },
  { id: 'north_western', nameEn: 'North Western Province', nameSi: 'වයඹ පළාත' },
  { id: 'north_central', nameEn: 'North Central Province', nameSi: 'උතුරු මැද පළාත' },
  { id: 'uva', nameEn: 'Uva Province', nameSi: 'ඌව පළාත' },
  { id: 'sabaragamuwa', nameEn: 'Sabaragamuwa Province', nameSi: 'සබරගමුව පළාත' },
];

export const DISTRICTS: DistrictData[] = [
  // Western
  { id: 'colombo', provinceId: 'western', nameEn: 'Colombo', nameSi: 'කොළඹ' },
  { id: 'gampaha', provinceId: 'western', nameEn: 'Gampaha', nameSi: 'ගම්පහ' },
  { id: 'kalutara', provinceId: 'western', nameEn: 'Kalutara', nameSi: 'කළුතර' },
  // Central
  { id: 'kandy', provinceId: 'central', nameEn: 'Kandy', nameSi: 'මහනුවර' },
  { id: 'matale', provinceId: 'central', nameEn: 'Matale', nameSi: 'මාතලේ' },
  { id: 'nuwara_eliya', provinceId: 'central', nameEn: 'Nuwara Eliya', nameSi: 'නුවරඑළිය' },
  // Southern
  { id: 'galle', provinceId: 'southern', nameEn: 'Galle', nameSi: 'ගාල්ල' },
  { id: 'matara', provinceId: 'southern', nameEn: 'Matara', nameSi: 'මාතර' },
  { id: 'hambantota', provinceId: 'southern', nameEn: 'Hambantota', nameSi: 'හම්බන්තොට' },
  // Northern
  { id: 'jaffna', provinceId: 'northern', nameEn: 'Jaffna', nameSi: 'යාපනය' },
  { id: 'kilinochchi', provinceId: 'northern', nameEn: 'Kilinochchi', nameSi: 'කිලිනොච්චිය' },
  { id: 'mannar', provinceId: 'northern', nameEn: 'Mannar', nameSi: 'මන්නාරම' },
  { id: 'vavuniya', provinceId: 'northern', nameEn: 'Vavuniya', nameSi: 'වවුනියාව' },
  { id: 'mullaitivu', provinceId: 'northern', nameEn: 'Mullaitivu', nameSi: 'මුලතිව්' },
  // Eastern
  { id: 'batticaloa', provinceId: 'eastern', nameEn: 'Batticaloa', nameSi: 'මඩකලපුව' },
  { id: 'ampara', provinceId: 'eastern', nameEn: 'Ampara', nameSi: 'අම්පාර' },
  { id: 'trincomalee', provinceId: 'eastern', nameEn: 'Trincomalee', nameSi: 'ත්‍රිකුණාමලය' },
  // North Western
  { id: 'kurunegala', provinceId: 'north_western', nameEn: 'Kurunegala', nameSi: 'කුරුණෑගල' },
  { id: 'puttalam', provinceId: 'north_western', nameEn: 'Puttalam', nameSi: 'පුත්තලම' },
  // North Central
  { id: 'anuradhapura', provinceId: 'north_central', nameEn: 'Anuradhapura', nameSi: 'අනුරාධපුරය' },
  { id: 'polonnaruwa', provinceId: 'north_central', nameEn: 'Polonnaruwa', nameSi: 'පොළොන්නරුව' },
  // Uva
  { id: 'badulla', provinceId: 'uva', nameEn: 'Badulla', nameSi: 'බදුල්ල' },
  { id: 'monaragala', provinceId: 'uva', nameEn: 'Monaragala', nameSi: 'මොනරාගල' },
  // Sabaragamuwa
  { id: 'ratnapura', provinceId: 'sabaragamuwa', nameEn: 'Ratnapura', nameSi: 'රත්නපුරය' },
  { id: 'kegalle', provinceId: 'sabaragamuwa', nameEn: 'Kegalle', nameSi: 'කෑගල්ල' },
];
