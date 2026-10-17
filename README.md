# Autodrom — Drive & Build

Tarayıcıda çalışan, üçüncü şahıs kameralı 3D araba tycoon oyunu.

## Çalıştırma

```bash
npm install
npm run dev
```

Vite yerel adresi terminalde gösterir. Üretim derlemesi için `npm run build` kullanılır.

## Kontroller

- **W / S:** Gaz; fren ve durduktan sonra geri hareket
- **A / D:** Direksiyon
- **Q / E:** Geri / boş / 1–6 ileri vitesler arasında geçiş
- **Space:** El freni ve kayma
- **Esc:** Duraklatma menüsü

## Oyun sistemleri

- İlk kayıtta ₺10.000 ve üç farklı ücretsiz başlangıç aracı
- Gerçek sürüş hızına ve aracın katalog fiyatına bağlı, 3 saniyelik gelir
- Şehir içi ve otoban ortamları
- 8 araçlık, 5 sınıflı katalog; satın alma ve garaj sahipliği
- Üçüncü şahıs takip kamerası, hız/vites/devir göstergesi ve drift izleri
- LocalStorage kaydı: para, araçlar, harita ve grafik ayarları
- Ağ bağlantısı gerektirmeyen prosedürel araç görselleri ve haritalar

## Proje yapısı

- `src/engine.ts`: Three.js sahnesi, sürüş, kamera ve gelir döngüsü
- `src/world.ts`: Şehir içi ve otoban sahneleri
- `src/vehicle.ts`: Modüler prosedürel otomobil görselleri ve GLB yükleyici
- `src/data.ts`: Araç kataloğu ve ekonomi ayarları
- `src/economy.ts`: Sürüş gelir hesabı
- `src/save.ts`: Kayıt doğrulama ve ayarlar
- `src/ui.ts`: HUD, menüler, araç galerisi ve 3D önizleme

## Tripo 3D modelleri

Üretim planı ve her araç için hedeflenen GLB dosya adları [TRIPO-PLAN.md](./TRIPO-PLAN.md) içinde. Tripo modelleri henüz indirilmedi; yerel prosedürel modeller oyunun çalışmasını sağlıyor. Onaylanıp indirilen her GLB, katalogdaki `modelPath` üzerinden otomatik yüklenir.
