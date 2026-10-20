# Araç modeli ve teknik veri notları

Araştırma ve GLB envanteri tarihi: **17 Ekim 2026**. Araç kimlikleri, oyun fiyatları ve gerçek araç verileri tek katalogda tutulur: [`src/data.ts`](../../../src/data.ts). `price` oyun içi fiyatıdır; gerçek piyasa referansı varsa `realSpecs.turkeyPriceTry` alanında, ayrı not ve tarihle saklanır. Gerçek değerler sürüş fiziğine otomatik aktarılmaz.

## Model eşleştirmesi ve GLB incelemesi

Dosyalar taşınmadı veya yeniden adlandırılmadı. `public/assets/models/manifest.json` yalnızca mağazaya bağlanan model kimliklerini listeler. GLB yüklemesi mağaza/garaj önizlemesi ya da araca geçiş sırasında yapılır; katalogdaki bütün araçlar başlangıçta belleğe alınmaz. Bozuk veya bulunamayan model için prosedürel araç görünümü korunur.

Mevcut `BMW M3 GTR` modeli `public/assets/models/bmw_m3_gtr_-_nfs_mw.glb` yolunda kaldı. Dosya adı NFS Most Wanted görünümünü işaret ettiği için gerçek teknik değerler 2001 BMW ALMS yarış M3 GTR’ından referans alınır; yol homologasyonlu az sayıdaki otomobilin değerleriyle karıştırılmaz.

GLB sahneleri ve düğümleri incelendi. Altı modelde dört ayrı `3DWheel Front/Rear L/R` dönüş düğümü bulundu; bunlar araç hareket ederken mevcut tekerlek dönüş sistemine bağlanır. Diğer modellerde tekerlekler birleşik geometri, tekerlek parçası veya pivotsuz mesh olarak görünüyor. Dosya adından hareketle dönüş merkezi uydurulmadı; böyle modellerde GLB tekerlekleri modelin kendi görünümünde kalır.

| Oyun aracı | GLB yolu (GLB klasörüne göre) | Tekerlek yapısı |
|---|---|---|
| BMW M3 E36 | `BMW/M3/1993_bmw_m3_coupe_e36.glb` | Tire/rim meshleri var; dört dönüş pivotu yok |
| BMW M3 CSL E46 | `BMW/M3/2003_bmw_m3_csl_e46.glb` | Dört tire mesh adı var; ayrı pivot yok |
| BMW M3 E46 | `BMW/M3/2005_bmw_m3_e46.glb` | Tekerlek düğümleri isimlendirilmemiş |
| BMW M3 E92 | `BMW/M3/2008_bmw_m3_e92.glb` | Wheel meshleri var; dört pivot doğrulanmadı |
| BMW M3 E92 Liberty Walk | `BMW/M3/2013_bmw_m3_e92_lbworks_ver.2.glb` | Dört dönüş pivotu |
| BMW M3 E46 (M2 Motoring) | `BMW/M3/2014_m2_motoring_bmw_m3_e46.glb` | Jant/lastik meshleri var; dört pivot doğrulanmadı |
| BMW M4 (Duke Dynamics MD4) | `BMW/M4/2014_bmw_m4_based_md4_by_duke_dynamics.glb` | Dört dönüş pivotu |
| BMW M4 Competition | `BMW/M4/2025_bmw_m4_competition.glb` | Dört dönüş pivotu |
| BMW M4 GT3 EVO | `BMW/M4/2025_bmw_m4_gt3_evo_g82.glb` | Dört dönüş pivotu |
| BMW M4 Varis | `BMW/M4_old/2015_varis_full_widebody_kit_f82_bmw_m4.glb` | Dört dönüş pivotu |
| Honda Civic Type R EK9 | `HONDA/2000_honda_civic_type_r_ek9.glb` | Dört dönüş pivotu |
| Lamborghini Gallardo LP560-4 Spyder | `LAMBORGHINI/2009_lamborghini_gallardo_lp560-4_spyder.glb` | Lastik/fren parçaları var; dört pivot doğrulanmadı |
| Mercedes-Benz SLR McLaren 722 Edition | `MERCEDES/asphalt_8_-_mercedesbenz_slr_mclaren_722_edition.glb` | 7 meshli, tekerlek pivotu görünmüyor |
| Renault Mégane R.S. 250 Cup | `RENAULT/2010_renault_megane_rs_250_cup.glb` | Genel grup/mesh yapısı; pivot görünmüyor |
| Bugatti La Voiture Noire  | `BUGATTI/bugatti_la_voiture_noire.glb` | Dört dönüş pivotu |

Model yönü dosya yapısı ve adlandırılmış tekerlek pivotlarıyla kontrol edildi. Modeller kendi uzunluk ölçüsüne göre mevcut oyun ölçeğine uydurulur, yatayda ortalanır ve taban noktası zemine alınır. Bu işlem gerçek otomobil verisini veya sürüş parametrelerini değiştirmez. Mağaza kamerası model sınır kutusuna ve ekran oranına göre mesafesini ayarlar; aracın oranları esnetilmez.

## Kaynaklar

| Kaynak kimliği | Üretici/kurum kaynağı | Kullanım |
|---|---|---|
| `BMW_E36` | [BMW PressClub — E36 M3 tarihçesi](https://www.press.bmwgroup.com/usa/article/detail/T0449845EN_US/bmw-na-50th-anniversary-50-stories-for-50-years-chapter-17-bmw-m-achieves-wide-appeal-unique-e36-m3-models-for-the-u-s) · [BMW İspanya teknik eki](https://www.press.bmwgroup.com/spain/article/attachment/T0245903ES/341132) | 1993 E36 için pazar sürümüne göre motor gücü/tork farkını not etme |
| `BMW_M3_GTR_RACE` | [BMW PressClub — 2001 ALMS M3 GTR yarış teknik verisi](https://www.press.bmwgroup.com/global/article/detail/T0003841EN/new-bmw-m3-gtr-unveiled-for-alms?language=en) · [BMW PressClub USA — 2001 M3 GTR yol sürümü ayrımı](https://www.press.bmwgroup.com/usa/article/detail/T0022073EN_US/the-bmw-m3-gtr-heads-for-the-road-the-truly-ultimate-driving-machine?language=en_US) | 3.997 cc, yaklaşık 480 Nm, 1.120 kg yarış sınıfı minimumu ve altı ileri yarış kutusu; 450 CV / 444 hp birim farkı. Yol sürümünün 350 hp ve yaklaşık 1.350 kg olduğu ayrıca belirtilir; katalog yarış sürümünü temel alır. |
| `BMW_CSL` | [BMW PressClub — 2003 BMW M3 CSL](https://www.press.bmwgroup.com/deutschland/article/detail/T0006229DE/bmw-m3-csl-auf-dem-genfer-automobil-salon-2003) | 3.246 cc, 360 PS, 370 Nm, 1.385 kg; CSL teknik verisi |
| `BMW_E46` | [BMW PressClub — M3 teknik verileri](https://www.press.bmwgroup.com/italy/article/attachment/T0082320IT/125300) | 2000–2006 E46 Coupé/CSL karşılaştırması; 343 PS M3 verileri |
| `BMW_E92` | [BMW PressClub — 2008 Avrupa M3 Coupé teknik verisi](https://www.press.bmwgroup.com/france/article/attachment/T0026570FR/46666) · [BMW PressClub — 2008 M3 ABD teknik verisi](https://www.press.bmwgroup.com/usa/article/attachment/T0017997EN_US/35557) | Avrupa 420 PS / ABD 414 SAE hp ayrımını ve ağırlık/şanzıman seçeneklerini belirtme |
| `BMW_F82` | [BMW PressClub — F80/F82/F83 teknik ve fiyat listesi](https://www.press.bmwgroup.com/south-africa/article/attachment/T0197084EN/287155) | 2014–15 F82 M4: 2.979 cc, 431 PS, 550 Nm; 6MT/7 çift kavrama seçenekleri |
| `BMW_G82` | [BMW PressClub — 2025 M4 Coupé](https://www.press.bmwgroup.com/usa/article/detail/T0439244EN_US/the-new-2025-bmw-m4-coupe-and-m4-convertible) · [BMW PressClub — M4 Competition M xDrive motoru](https://www.press.bmwgroup.com/united-kingdom/article/detail/T0439398EN_GB/the-new-bmw-m4-competition-coup%C3%A9-with-m-xdrive-and-the-new-bmw-m4-competition-convertible-with-m-xdrive) | 2025 yılı ve G82 Competition motor/versiyon farkları |
| `BMW_GT3_EVO` | [BMW PressClub — M4 GT3 EVO teknik verileri](https://www.press.bmwgroup.com/global/article/detail/T0442652EN/presentation-of-the-bmw-m4-gt3-evo-at-the-nuerburgring%3A-bmw-m-motorsport-makes-the-successful-model-even-better) | 2025 yarış aracı; 2.993 cc, üretici üst sınırı 590 hp, X-Trac 6 ileri; tork ve ağırlık bu teknik sayfada yok |
| `HONDA_EK9` | [Honda Global — EK9 Type R teknik özellikleri (PDF)](https://global.honda/content/dam/site/global-jp/news-new/cq_img/1997/10/4971000a.pdf) · [Honda Global — Civic Type R tarihçesi](https://global.honda/en/stories/048.html) | 1.595 cc, 185 PS, yaklaşık 160 Nm, 1.070 kg, 5 ileri manuel |
| `LAMBORGHINI_GALLARDO` | [Lamborghini MY09 LP560-4 ürün bilgi dosyası (PDF)](https://teamspeed.com/forums/attachment.php?attachmentid=9128&d=1213280742) · [Lamborghini PressClub — Spyder tanıtımı (PDF)](https://preview.thenewsmarket.com/Previews/lamb/DocumentAssets/267507.pdf) | 5.204 cc, 560 CV, 540 Nm, AWD; MY09 ağırlık/şanzıman notları |
| `MERCEDES_SLR_722` | [Mercedes-Benz Media — SLR McLaren 722 Edition](https://media.mercedes-benz.it/mercedes-benz-slr-mclaren-722-edition-dubai/) · [Mercedes-Benz Media — SLR 722 Coupé teknik bilgisi](https://media.mercedes-benz.fr/serie-limitee-slr-722-gt--un-supercar-dexception/) | 2007 lansmanı, 5,5 litre, 650 CV ve 820 Nm; dosyanın yıl bilgisi olmadığından notla gösterilir |
| `RENAULT_RS250` | [Renault Media — Mégane R.S. lansman açıklaması](https://media.renault.ch/fr/article/19012) | 2,0 litre turbo, 250 ch, 340 Nm; Sport/Cup şasi seçeneği |
| `TR_BMW_2026` | [Borusan Oto BMW — 2026 model yılı M fiyat listesi](https://borusanoto.bmw.com.tr/fiyat-listesi/bmw-m-serisi) | 11.09.2026 tarihinde 2026 BMW M4 Competition Coupé M xDrive için 19.308.500 TL tavsiye edilen azami anahtar teslim fiyatı |

Üretimi sona ermiş araçlar ve gövde kiti sürümleri için Türkiye'de aynı model yılı, kondisyon ve donanımı temsil eden doğrulanabilir bir tekil güncel fiyat bulunmadığından gerçek piyasa fiyatı alanı doldurulmadı. Sadece M4 Competition için erişilebilir 2026 Türkiye liste fiyatı ayrı bir **referans** alanında tutulur; 2025 model varlığının birebir fiyatı olarak sunulmaz. Oyun fiyatları bundan bağımsız, oyunun başlangıç bakiyesi ve araç sınıfına göre ayarlanmıştır.

## Belirsizlikler

- `2014_m2_motoring_bmw_m3_e46.glb` yolundaki `2014` ibaresi otomobilin model yılı olarak doğrulanamadı; katalog yılı boş bırakır. Motor bilgisi yalnızca standart E46 M3 tabanına referanstır.
- 2025 M4 Competition dosyasında arkadan itiş ve M xDrive ayrımı seçilemiyor. Bu nedenle gerçek motor gücü, tahrik ve ağırlık alanları boş; 3,0 litre motor ve ortak tork değeri belirtilir.
- M4 GT3 EVO yarış aracında güç BoP ayarına göre değişir; üretici “590 hp'ye kadar” der. Tork/ağırlık için doğrulanmış değer yoktur.
- Modifiye Liberty Walk, M2 Motoring, Duke Dynamics ve Varis GLB'leri gövde görünümünü gösterir. Motor dönüşümü kanıtlanmadığından bu araçlarda fabrika tabanının teknik verileri referans kabul edilir ve notla işaretlenir.
- Renault, Mercedes ve Gallardo için erişilen üretici açıklamaları modelin motorunun bir kısmını doğrulasa da tüm ağırlık/şanzıman varyantlarını aynı sayfada açıklamıyor; doğrulanmayan alanlar boş bırakılır.
