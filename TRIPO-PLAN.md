# Tripo 3D araç modeli planı

**Durum (16 Ekim 2026):** Tripo CLI hesabı yetkilendirildi; kullanılabilir bakiye son kayıtta **0 kredi**. Hiçbir model üretim isteği gönderilmedi ve kredi harcanmadı. BMW M3 E36 için kullanıcı modeli eklendiğinden yedi Tripo modeli kaldı; tahmini toplam 280 kredi gerekiyor. Bakiye yüklendikten sonra ücretli üretim, kullanıcıdan bu plan için açık onay alınarak başlatılmalı.

Her kuru çalıştırma CLI tarafından doğrulandı: `POST /v3/generation/text-to-model`, model `P1-20260311`, `face_limit=15000`, `auto_size=true`, `texture=true`, `pbr=true`. Model başına tek üretim adımı var; ücretli format dönüştürmesi eklenmedi. Her araç için hedef çıktı dokulu GLB; üretim dizinindeki `model.glb`, uygulamanın kullandığı `public/assets/models/<id>.glb` yoluna kopyalanacak.

| Araç | İstek özeti | Son dosya | Tahmini kredi |
| --- | --- | --- | ---: |
| Cedar Mini | Yuvarlak tavanlı, kısa dingilli kompakt ekonomi hatchback | `cedar-mini.glb` | 40 |
| Metro S1 | Kavisli önlü, beş kapılı şehir hatchback'i | `metro-s1.glb` | 40 |
| Lumen X | Uzun tavan çizgili, dört kapılı fastback sedan | `lumen-x.glb` | 40 |
| BMW M3 E36 | Kullanıcının eklediği E36 M3 modeli | `bmw_e36_m3.glb` (kullanıcı modeli) | — |
| Vanta R | Açık tavanlı, alçak roadster | `vanta-r.glb` | 40 |
| Sprint R | Geniş omuzlu ve yan havalandırmalı performans sedani | `sprint-r.glb` | 40 |
| Atlas RS | Uzun kaputlu, alçak tavanlı grand touring coupe | `atlas-rs.glb` | 40 |
| Nova One | Kama biçimli burunlu, geniş orta motor süper otomobil | `nova-one.glb` | 40 |
| **Tripo toplamı** | **7 özgün P1 araç modeli** | **7 dokulu GLB** | **≈280** |

Üretimden sonra her `preview.png` incelenecek; model yönü, ölçeği, tekerlekleri ve zemin teması oyunda kontrol edilecek.

## Kullanıcının eklediği BMW M3 GTR

Kullanıcı `public/assets/models/bmw_m3_gtr_-_nfs_mw.glb` dosyasını ekledi. Dosyanın GLB içi kaydı Sketchfab kaynağını ve CC-BY-4.0 lisansını belirtiyor; atıf `public/assets/models/ATTRIBUTION.md` içinde tutuluyor. Model `bmw-m3-gtr` olarak manifest'e eklendi ve araç ayarlarında gerçek model yönü, 4.61 m uzunluk ve 1.38 m yükseklikle eşleştirildi. Bu model için Tripo kredisi harcanmadı.

Kullanıcı `public/assets/models/bmw_e36_m3.glb` dosyasını Rally GT'nin yerine ekledi. Oyundaki kimliği `m3-e36`; GLB'deki büyük zemin parçası modelden çıkarılıp modelin yönü ve ölçeği araç ölçülerine göre ayarlanıyor. Sketchfab atfı `public/assets/models/ATTRIBUTION.md` içinde tutuluyor; Tripo kredisi harcanmadı.
