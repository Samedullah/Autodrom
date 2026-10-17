export type CarClass = 'EKONOMI' | 'SEHIR' | 'SPORT' | 'PERFORMANS' | 'SUPER';
export type BodyStyle = 'hatch' | 'sedan' | 'coupe' | 'roadster' | 'sport' | 'super';
export type MapId = 'city-highway';

export interface RealVehicleSpecs {
  modelYear?: number;
  powerHp?: number;
  engineDisplacementCc?: number;
  torqueNm?: number;
  drive?: string;
  weightKg?: number;
  transmission?: string;
  turkeyPriceTry?: number;
  turkeyPriceNote?: string;
  sourceIds: string[];
  note?: string;
}

export interface VehicleSpec {
  id: string;
  name: string;
  shortName: string;
  subtitle: string;
  brand: string;
  category: CarClass;
  price: number;
  maxSpeed: number;
  acceleration: number;
  braking: number;
  handling: number;
  steering: number;
  power: number;
  bodyStyle: BodyStyle;
  bodyColor: string;
  length: number;
  width: number;
  height: number;
  modelPath: string;
  modelRotationY?: number;
  modelExcludeNodes?: string[];
  realSpecs?: RealVehicleSpecs;
  starterChoice: boolean;
}

export const ECONOMY = {
  startingCash: 10000,
  payoutEverySeconds: 3,
  kmhPerUnit: 3.6,
  speedStepKmh: 20,
  marketMultiplier: 100000,
  minimumPayoutSpeed: 1,
  maxCreditedElapsedSeconds: 3,
} as const;

export const VEHICLES: VehicleSpec[] = [
  {
    id: 'cedar-mini', name: 'Cedar Mini', shortName: 'CEDAR', subtitle: 'Şehir için hafif ve tutumlu',
    brand: 'Autodrom',
    category: 'EKONOMI', price: 8000, maxSpeed: 148, acceleration: 7.2, braking: 12.5,
    handling: 0.78, steering: 1.05, power: 92, bodyStyle: 'hatch', bodyColor: '#c9d8b7',
    length: 3.82, width: 1.68, height: 1.47, modelPath: '/assets/models/cedar-mini.glb', starterChoice: false,
  },
  {
    id: 'metro-s1', name: 'Metro S1', shortName: 'METRO', subtitle: 'Dengeli şehir otomobili',
    brand: 'Autodrom',
    category: 'SEHIR', price: 45000, maxSpeed: 184, acceleration: 9.1, braking: 14.2,
    handling: 0.84, steering: 1.12, power: 132, bodyStyle: 'hatch', bodyColor: '#65c2a2',
    length: 4.18, width: 1.78, height: 1.47, modelPath: '/assets/models/metro-s1.glb', starterChoice: true,
  },
  {
    id: 'lumen-x', name: 'Lumen X', shortName: 'LUMEN', subtitle: 'Sessiz, konforlu ve çevik',
    brand: 'Autodrom',
    category: 'SEHIR', price: 39000, maxSpeed: 168, acceleration: 8.2, braking: 15.1,
    handling: 0.88, steering: 1.18, power: 148, bodyStyle: 'sedan', bodyColor: '#e4c786',
    length: 4.45, width: 1.82, height: 1.45, modelPath: '/assets/models/lumen-x.glb', starterChoice: false,
  },
  {
    id: 'm3-e36', name: 'BMW M3 E36', shortName: 'M3 E36', subtitle: 'E36 gövde, sıralı altı silindir', brand: 'BMW',
    category: 'SPORT', price: 82000, maxSpeed: 228, acceleration: 13.4, braking: 17.2,
    handling: 0.92, steering: 1.28, power: 248, bodyStyle: 'coupe', bodyColor: '#eb8062',
    length: 4.38, width: 1.86, height: 1.31,
    modelPath: '/assets/models/GLB/BMW/M3/1993_bmw_m3_coupe_e36.glb', modelRotationY: 0,
    realSpecs: { modelYear: 1993, powerHp: 286, engineDisplacementCc: 2990, torqueNm: 320, drive: 'RWD', transmission: '5 ileri manuel', sourceIds: ['BMW_E36'], note: '286 hp ve 320 Nm Avrupa S50B30 sürümünü temel alır; ABD sürümünün gücü farklıdır.' },
    starterChoice: true,
  },
  {
    id: 'vanta-r', name: 'Vanta R', shortName: 'VANTA', subtitle: 'Alçak gövde, canlı tepki',
    brand: 'Autodrom',
    category: 'SPORT', price: 99000, maxSpeed: 244, acceleration: 15.2, braking: 18.4,
    handling: 0.9, steering: 1.31, power: 312, bodyStyle: 'roadster', bodyColor: '#d783d0',
    length: 4.26, width: 1.9, height: 1.27, modelPath: '/assets/models/vanta-r.glb', starterChoice: false,
  },
  {
    id: 'sprint-r', name: 'Sprint R', shortName: 'SPRINT', subtitle: 'Güçlü çekiş ve keskin yön',
    brand: 'Autodrom',
    category: 'PERFORMANS', price: 155000, maxSpeed: 278, acceleration: 19.2, braking: 20.5,
    handling: 0.95, steering: 1.36, power: 426, bodyStyle: 'sport', bodyColor: '#7b9de8',
    length: 4.56, width: 1.94, height: 1.32, modelPath: '/assets/models/sprint-r.glb', starterChoice: true,
  },
  {
    id: 'atlas-rs', name: 'Atlas RS', shortName: 'ATLAS', subtitle: 'Uzun yolda yüksek performans',
    brand: 'Autodrom',
    category: 'PERFORMANS', price: 195000, maxSpeed: 292, acceleration: 18.4, braking: 21.2,
    handling: 0.91, steering: 1.28, power: 510, bodyStyle: 'coupe', bodyColor: '#efb452',
    length: 4.78, width: 1.96, height: 1.34, modelPath: '/assets/models/atlas-rs.glb', starterChoice: false,
  },
  {
    id: 'nova-one', name: 'Nova One', shortName: 'NOVA', subtitle: 'Hafif karbon gövde, saf hız',
    brand: 'Autodrom',
    category: 'SUPER', price: 550000, maxSpeed: 352, acceleration: 25.5, braking: 24.8,
    handling: 0.98, steering: 1.48, power: 785, bodyStyle: 'super', bodyColor: '#db5e55',
    length: 4.7, width: 2.02, height: 1.16, modelPath: '/assets/models/nova-one.glb', starterChoice: false,
  },
  {
    id: 'bmw-m3-gtr', name: 'BMW M3 GTR', shortName: 'M3 GTR', subtitle: 'E46 gövde, V8 yarış ruhu',
    brand: 'BMW',
    category: 'SUPER', price: 1250000, maxSpeed: 312, acceleration: 21.8, braking: 23.1,
    handling: 0.96, steering: 1.43, power: 550, bodyStyle: 'sport', bodyColor: '#e5e8df',
    length: 4.61, width: 1.91, height: 1.38, modelPath: '/assets/models/bmw_m3_gtr_-_nfs_mw.glb', modelRotationY: Math.PI,
    realSpecs: { modelYear: 2001, powerHp: 450, engineDisplacementCc: 3997, torqueNm: 480, drive: 'RWD', weightKg: 1120, transmission: '6 ileri düz dişli manuel', sourceIds: ['BMW_M3_GTR_RACE'], note: 'NFS Most Wanted görünümündeki GLB, BMW’nin 2001 ALMS yarış M3 GTR’ına referans verir. 450 CV (BMW USA kaynağında 444 hp), yaklaşık 480 Nm ve 1.120 kg yarış minimum ağırlığıdır; yol homologasyonlu araç verileri farklıdır.' },
    starterChoice: false,
  },
  {
    id: 'bmw-m3-csl-e46', name: 'BMW M3 CSL E46', shortName: 'M3 CSL', subtitle: 'Hafifletilmiş, yüksek devirli özel seri', brand: 'BMW',
    category: 'PERFORMANS', price: 235000, maxSpeed: 250, acceleration: 17.6, braking: 19.4,
    handling: 0.96, steering: 1.37, power: 360, bodyStyle: 'coupe', bodyColor: '#d9d8cd',
    length: 4.49, width: 1.78, height: 1.37,
    modelPath: '/assets/models/GLB/BMW/M3/2003_bmw_m3_csl_e46.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2003, powerHp: 360, engineDisplacementCc: 3246, torqueNm: 370, drive: 'RWD', weightKg: 1385, transmission: '6 ileri SMG II', sourceIds: ['BMW_CSL'], note: 'BMW CSL için SMG II şanzımanı standart verdiğini belirtir.' }, starterChoice: false,
  },
  {
    id: 'bmw-m3-e46-2005', name: 'BMW M3 E46', shortName: 'M3 E46', subtitle: '3,2 litrelik atmosferik sıralı altı', brand: 'BMW',
    category: 'SPORT', price: 185000, maxSpeed: 250, acceleration: 16.8, braking: 18.8,
    handling: 0.94, steering: 1.34, power: 343, bodyStyle: 'coupe', bodyColor: '#7398a8',
    length: 4.49, width: 1.78, height: 1.37,
    modelPath: '/assets/models/GLB/BMW/M3/2005_bmw_m3_e46.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2005, powerHp: 343, engineDisplacementCc: 3246, torqueNm: 365, drive: 'RWD', weightKg: 1570, transmission: '6 ileri manuel; SMG II opsiyon', sourceIds: ['BMW_E46'], note: 'Motor ve 1.570 kg DIN değeri Avrupa M3 Coupé verileridir; dosya şanzıman seçeneğini belirtmiyor.' }, starterChoice: false,
  },
  {
    id: 'bmw-m3-e92-2008', name: 'BMW M3 E92', shortName: 'M3 E92', subtitle: 'Yüksek devirli 4,0 litre V8', brand: 'BMW',
    category: 'PERFORMANS', price: 310000, maxSpeed: 250, acceleration: 19.5, braking: 20.4,
    handling: 0.94, steering: 1.38, power: 420, bodyStyle: 'coupe', bodyColor: '#9b9da4',
    length: 4.62, width: 1.80, height: 1.42,
    modelPath: '/assets/models/GLB/BMW/M3/2008_bmw_m3_e92.glb', modelRotationY: -Math.PI / 2,
    realSpecs: { modelYear: 2008, powerHp: 420, engineDisplacementCc: 3999, torqueNm: 400, drive: 'RWD', weightKg: 1655, transmission: '6 ileri manuel; 7 ileri M-DCT opsiyon', sourceIds: ['BMW_E92'], note: 'Ağırlık Avrupa EU ölçümüdür; gövde kiti/donanım ve ABD pazarı değerleri farklı olabilir.' }, starterChoice: false,
  },
  {
    id: 'bmw-m3-e92-lbworks', name: 'BMW M3 E92 Liberty Walk', shortName: 'M3 LB WORKS', subtitle: '2013 E92 tabanı ve geniş gövde kiti', brand: 'BMW',
    category: 'PERFORMANS', price: 385000, maxSpeed: 268, acceleration: 20.1, braking: 20.8,
    handling: 0.91, steering: 1.35, power: 420, bodyStyle: 'sport', bodyColor: '#bd594d',
    length: 4.62, width: 2.02, height: 1.42,
    modelPath: '/assets/models/GLB/BMW/M3/2013_bmw_m3_e92_lbworks_ver.2.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2013, powerHp: 420, engineDisplacementCc: 3999, torqueNm: 400, drive: 'RWD', weightKg: 1655, transmission: '6 ileri manuel; 7 ileri M-DCT opsiyon', sourceIds: ['BMW_E92'], note: 'Dosya adı Liberty Walk gövde kiti gösteriyor; motor verisi E92 fabrika tabanı, ağırlık ise kit etkisi dışındaki Avrupa Coupé referansıdır.' }, starterChoice: false,
  },
  {
    id: 'bmw-m3-e46-m2-motoring', name: 'BMW M3 E46 (M2 Motoring)', shortName: 'M3 M2', subtitle: 'E46 tabanı, modifiye gövde', brand: 'BMW',
    category: 'PERFORMANS', price: 340000, maxSpeed: 272, acceleration: 20.2, braking: 20.6,
    handling: 0.93, steering: 1.38, power: 343, bodyStyle: 'sport', bodyColor: '#d5aa54',
    length: 4.49, width: 1.96, height: 1.37,
    modelPath: '/assets/models/GLB/BMW/M3/2014_m2_motoring_bmw_m3_e46.glb', modelRotationY: 0,
    realSpecs: { powerHp: 343, engineDisplacementCc: 3246, torqueNm: 365, drive: 'RWD', transmission: '6 ileri manuel; SMG II opsiyon', sourceIds: ['BMW_E46'], note: 'Dosya adındaki 2014 model yılı olarak doğrulanamadı. E46 M3 fabrika verileri yalnızca motor referansıdır; M2 Motoring modifikasyon değerleri bilinmiyor.' }, starterChoice: false,
  },
  {
    id: 'bmw-m4-duke-md4', name: 'BMW M4 (Duke Dynamics MD4)', shortName: 'M4 MD4', subtitle: 'F82 tabanı, Duke Dynamics gövdesi', brand: 'BMW',
    category: 'PERFORMANS', price: 465000, maxSpeed: 285, acceleration: 21.2, braking: 21.1,
    handling: 0.94, steering: 1.4, power: 431, bodyStyle: 'sport', bodyColor: '#57a49e',
    length: 4.67, width: 1.92, height: 1.39,
    modelPath: '/assets/models/GLB/BMW/M4/2014_bmw_m4_based_md4_by_duke_dynamics.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2014, powerHp: 431, engineDisplacementCc: 2979, torqueNm: 550, drive: 'RWD', transmission: '6 ileri manuel veya 7 ileri M-DCT', sourceIds: ['BMW_F82'], note: 'Dosya gövdeyi Duke Dynamics MD4 olarak tanımlıyor; aktarma ve motor değerleri 2014 F82 M4 tabanından.' }, starterChoice: false,
  },
  {
    id: 'bmw-m4-competition-2025', name: 'BMW M4 Competition (2025)', shortName: 'M4 COMP.', subtitle: 'G82 Competition Coupé', brand: 'BMW',
    category: 'SUPER', price: 890000, maxSpeed: 300, acceleration: 23.6, braking: 22.4,
    handling: 0.97, steering: 1.45, power: 530, bodyStyle: 'coupe', bodyColor: '#3f80b0',
    length: 4.80, width: 1.89, height: 1.40,
    modelPath: '/assets/models/GLB/BMW/M4/2025_bmw_m4_competition.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2025, engineDisplacementCc: 2993, torqueNm: 650, transmission: '8 ileri M Steptronic', turkeyPriceTry: 19308500, turkeyPriceNote: '2026 model yılı M4 Competition Coupé M xDrive için Türkiye yetkili satıcısının 11.09.2026 azami anahtar teslim fiyatı; 2025 GLB varyantının birebir liste fiyatı değildir.', sourceIds: ['BMW_G82', 'TR_BMW_2026'], note: 'Dosyada RWD / M xDrive sürümü ayırt edilmiyor. Güç ve ağırlık/tahrik değerleri sürüme göre değişir; kesinleştirilemeyen alanları boş bıraktım.' }, starterChoice: false,
  },
  {
    id: 'bmw-m4-gt3-evo', name: 'BMW M4 GT3 EVO', shortName: 'M4 GT3 EVO', subtitle: '2025 sezonu GT yarış otomobili', brand: 'BMW',
    category: 'SUPER', price: 1850000, maxSpeed: 315, acceleration: 25.4, braking: 24.1,
    handling: 0.99, steering: 1.48, power: 590, bodyStyle: 'super', bodyColor: '#e1e4dc',
    length: 5.02, width: 2.04, height: 1.31,
    modelPath: '/assets/models/GLB/BMW/M4/2025_bmw_m4_gt3_evo_g82.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2025, powerHp: 590, engineDisplacementCc: 2993, transmission: 'X-Trac 6 ileri yarış şanzımanı', sourceIds: ['BMW_GT3_EVO'], note: '590 hp üretici tarafından belirtilen üst sınırdır. FIA Balance of Performance ayarına göre yarış gücü değişir; tork/ağırlık yayımlanan bu teknik sayfada yok.' }, starterChoice: false,
  },
  {
    id: 'bmw-m4-varis-f82', name: 'BMW M4 F82 Varis Widebody', shortName: 'M4 VARIS', subtitle: '2015 M4 tabanı ve Varis geniş gövde', brand: 'BMW',
    category: 'SUPER', price: 620000, maxSpeed: 292, acceleration: 22.4, braking: 21.5,
    handling: 0.93, steering: 1.43, power: 431, bodyStyle: 'sport', bodyColor: '#c34c43',
    length: 4.67, width: 2.02, height: 1.39,
    modelPath: '/assets/models/GLB/BMW/M4_old/2015_varis_full_widebody_kit_f82_bmw_m4.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2015, powerHp: 431, engineDisplacementCc: 2979, torqueNm: 550, drive: 'RWD', transmission: '6 ileri manuel veya 7 ileri M-DCT', sourceIds: ['BMW_F82'], note: 'Dosya adı Varis gövde kitini gösteriyor; performans değerleri fabrika F82 M4 tabanıdır.' }, starterChoice: false,
  },
  {
    id: 'honda-civic-type-r-ek9', name: 'Honda Civic Type R EK9', shortName: 'CIVIC EK9', subtitle: 'Hafif, önden çekişli Type R', brand: 'Honda',
    category: 'SPORT', price: 155000, maxSpeed: 230, acceleration: 13.1, braking: 17.8,
    handling: 0.92, steering: 1.28, power: 185, bodyStyle: 'hatch', bodyColor: '#c93332',
    length: 4.18, width: 1.70, height: 1.36,
    modelPath: '/assets/models/GLB/HONDA/2000_honda_civic_type_r_ek9.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2000, powerHp: 185, engineDisplacementCc: 1595, torqueNm: 160, drive: 'FWD', weightKg: 1070, transmission: '5 ileri manuel', sourceIds: ['HONDA_EK9'], note: 'Honda teknik belgesindeki 16,3 kgf·m tork 160 Nm olarak yuvarlandı.' }, starterChoice: false,
  },
  {
    id: 'lamborghini-gallardo-lp560-4-spyder', name: 'Lamborghini Gallardo LP560-4 Spyder', shortName: 'GALLARDO', subtitle: '5,2 litre V10 ve sürekli dört çeker', brand: 'Lamborghini',
    category: 'SUPER', price: 1450000, maxSpeed: 325, acceleration: 24.1, braking: 22.8,
    handling: 0.97, steering: 1.47, power: 560, bodyStyle: 'super', bodyColor: '#a7a9ad',
    length: 4.35, width: 1.90, height: 1.18,
    modelPath: '/assets/models/GLB/LAMBORGHINI/2009_lamborghini_gallardo_lp560-4_spyder.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2009, powerHp: 560, engineDisplacementCc: 5204, torqueNm: 540, drive: 'AWD', transmission: '6 ileri manuel veya 6 ileri E-Gear', sourceIds: ['LAMBORGHINI_GALLARDO'], note: 'LP560-4 Spyder teknik verisi; şanzıman otomatikleştirilmiş E-Gear veya manuel olabildiği için GLB sürümü kesin değil.' }, starterChoice: false,
  },
  {
    id: 'mercedes-slr-722-edition', name: 'Mercedes-Benz SLR McLaren 722 Edition', shortName: 'SLR 722', subtitle: '5,4 litre kompresörlü V8', brand: 'Mercedes-Benz',
    category: 'SUPER', price: 1350000, maxSpeed: 337, acceleration: 23.2, braking: 22.7,
    handling: 0.94, steering: 1.44, power: 650, bodyStyle: 'super', bodyColor: '#8c9292',
    length: 4.66, width: 1.91, height: 1.26,
    modelPath: '/assets/models/GLB/MERCEDES/asphalt_8_-_mercedesbenz_slr_mclaren_722_edition.glb', modelRotationY: Math.PI,
    realSpecs: { modelYear: 2007, powerHp: 650, engineDisplacementCc: 5439, torqueNm: 820, drive: 'RWD', transmission: '5 ileri AMG SPEEDSHIFT otomatik', sourceIds: ['MERCEDES_SLR_722'], note: 'Mercedes-Benz 722 Coupé basın verisi. Dosya model yılı içermiyor; 722 Edition’ın piyasaya çıkış yılı 2007.' }, starterChoice: false,
  },
  {
    id: 'renault-megane-rs-250-cup', name: 'Renault Mégane R.S. 250 Cup', shortName: 'MEGANE RS', subtitle: '2,0 litre turbo, Cup şasisi', brand: 'Renault',
    category: 'SPORT', price: 205000, maxSpeed: 250, acceleration: 15.7, braking: 19.2,
    handling: 0.94, steering: 1.33, power: 250, bodyStyle: 'hatch', bodyColor: '#75aa79',
    length: 4.30, width: 1.84, height: 1.43,
    modelPath: '/assets/models/GLB/RENAULT/2010_renault_megane_rs_250_cup.glb', modelRotationY: 0,
    realSpecs: { modelYear: 2010, powerHp: 250, engineDisplacementCc: 1998, torqueNm: 340, drive: 'FWD', transmission: '6 ileri manuel', sourceIds: ['RENAULT_RS250'], note: 'Renault 2009 lansman açıklaması Sport/Cup şasi seçenekleri için aynı 250 hp ve 340 Nm motoru belirtir.' }, starterChoice: false,
  },
];

export const STARTER_VEHICLES = VEHICLES.filter((vehicle) => vehicle.starterChoice);

export const CLASS_LABELS: Record<CarClass, string> = {
  EKONOMI: 'EKONOMİ', SEHIR: 'ŞEHİR', SPORT: 'SPORT', PERFORMANS: 'PERFORMANS', SUPER: 'SÜPER',
};

export const MAP_LABELS: Record<MapId, string> = { 'city-highway': 'Şehir + Otoban' };
