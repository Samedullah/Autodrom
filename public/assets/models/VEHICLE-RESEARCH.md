# Araç modeli ve teknik veri notları

Araştırma ve GLB envanteri tarihi: **20 Ekim 2026**. Araç kimlikleri, oyun fiyatları ve gerçek araç verileri tek katalogda tutulur: [`src/data.ts`](../../../src/data.ts). `price` oyun içi fiyatıdır; gerçek piyasa referansı varsa `realSpecs.turkeyPriceTry` alanında, ayrı not ve tarihle saklanır. Gerçek değerler sürüş fiziğine otomatik aktarılmaz.

## Model eşleştirmesi ve GLB incelemesi

Dosyalar taşınmadı veya yeniden adlandırılmadı. `public/assets/models/manifest.json` yalnızca mağazaya bağlanan model kimliklerini listeler. GLB yüklemesi mağaza/garaj önizlemesi ya da araca geçiş sırasında yapılır; katalogdaki bütün araçlar başlangıçta belleğe alınmaz. Bozuk veya bulunamayan model için prosedürel araç görünümü korunur.

Mevcut `BMW M3 GTR` modeli `public/assets/models/bmw_m3_gtr_-_nfs_mw.glb` yolunda kaldı. Dosya adı NFS Most Wanted görünümünü işaret ettiği için gerçek teknik değerler 2001 BMW ALMS yarış M3 GTR’ından referans alınır; yol homologasyonlu az sayıdaki otomobilin değerleriyle karıştırılmaz.

GLB sahneleri ve düğümleri incelendi. Altı modelde dört ayrı `3DWheel Front/Rear L/R` dönüş düğümü bulundu; bunlar araç hareket ederken mevcut tekerlek dönüş sistemine bağlanır. Diğer modellerde tekerlekler birleşik geometri, tekerlek parçası veya pivotsuz mesh olarak görünüyor. Dosya adından hareketle dönüş merkezi uydurulmadı; böyle modellerde GLB tekerlekleri modelin kendi görünümünde kalır.

| Oyun aracı | GLB yolu (GLB klasörüne göre) | Tekerlek yapısı |
|---|---|---|
| BMW M3 E36 | `BMW/M3/1993_bmw_m3_coupe_e36.glb` | Tire/rim meshleri var; dört dönüş pivotu yok |
| BMW M3 E36 (1993) | `BMW/M3/1993_bmw_m3_e36.glb` | Ayrı GLB; tekerlek pivotları ayrıca doğrulanmadı |
| BMW M3 CSL E46 | `BMW/M3/2003_bmw_m3_csl_e46.glb` | Dört tire mesh adı var; ayrı pivot yok |
| BMW M3 E46 | `BMW/M3/2005_bmw_m3_e46.glb` | Tekerlek düğümleri isimlendirilmemiş |
| BMW M3 E92 | `BMW/M3/2008_bmw_m3_e92.glb` | Wheel meshleri var; dört pivot doğrulanmadı |
| BMW M3 E92 Liberty Walk | `BMW/M3/2013_bmw_m3_e92_lbworks_ver.2.glb` | Dört dönüş pivotu |
| BMW M3 E92 Liberty Walk V2 | `BMW/M3/2013_bmw_m3_e92_lbworks_ver.2 4.glb` | Ayrı GLB varyantı; V2 kiti dosya adından eşleştirildi |
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
| BMW M2 | `BMW/M2/bmw_m2.glb` | Dört `bone_wheel_*_steer.001` pivotu |
| BMW M4 GTS | `BMW/M4/bmw_m4_gts.glb` | Dört `bone_wheel_*_steer.004` pivotu |
| Bugatti Chiron Super Sport 300+ | `BUGATTI/bugatti_chiron_super_sport_300.glb` | Adlandırılmış dört dönüş pivotu bulunamadı |
| Koenigsegg CC850 | `KOENIGGSEG/2022__koenigsegg_cc850.glb` | Adlandırılmış dört dönüş pivotu bulunamadı |
| Koenigsegg Regera | `KOENIGGSEG/koenigsegg_regera.glb` | Dört `bone_wheel_*_steer.001` pivotu |
| Lamborghini Huracán LP 610-4 LB Works | `LAMBORGHINI/2015_lamborghini_huracan_coupe_lbworks_body_kit.glb` | Dört ayrı pivot bulunamadı; tekerlek geometri adları birleştirilmiş görünüyor |
| McLaren 720S | `MCLAREN/mclaren_720s.glb` | Dört `bone_wheel_*_steer.003` pivotu |
| Mercedes-Benz CLK GTR | `MERCEDES/mercedes-benz_clk_gtr.glb` | Dört `bone_wheel_*_steer.001` pivotu |
| Pagani Zonda Cinque | `PAGANI/pagani_zonda_cinque.glb` | Dört tekerlek mesh grubu var; ayrı dönüş pivotu yok |
| Porsche Carrera GT | `PORSCHE/porsche_carrera_gt_-_low_poly.glb` | Dört dönüş grubu (`Wheel-Rear_*`, `Wheel-Frount-*`); GLB'de “Frount” yazım hatası var |
| Toyota Supra A80 | `TOYOTA/toyota_supra_a80_1993.glb` | İsimlendirilmiş tekerlek pivotu bulunamadı |

Model yönü dosya yapısı ve adlandırılmış tekerlek pivotlarıyla kontrol edildi. Modeller kendi uzunluk ölçüsüne göre mevcut oyun ölçeğine uydurulur, yatayda ortalanır ve taban noktası zemine alınır. Bu işlem gerçek otomobil verisini veya sürüş parametrelerini değiştirmez. Mağaza kamerası model sınır kutusuna ve ekran oranına göre mesafesini ayarlar; aracın oranları esnetilmez.

## Kaynaklar

| Kaynak kimliği | Üretici/kurum kaynağı | Kullanım |
|---|---|---|
| `BMW_E36` | [BMW PressClub — E36 M3 tarihçesi](https://www.press.bmwgroup.com/usa/article/detail/T0449845EN_US/bmw-na-50th-anniversary-50-stories-for-50-years-chapter-17-bmw-m-achieves-wide-appeal-unique-e36-m3-models-for-the-u-s) · [BMW İspanya teknik eki](https://www.press.bmwgroup.com/spain/article/attachment/T0245903ES/341132) | 1993 E36 için pazar sürümüne göre motor gücü/tork farkını not etme |
| `LIBERTYWALK_M3_E92` | [Liberty Walk — BMW M3 E92 Ver.1 ve Ver.2 kitleri](https://libertywalk.co.jp/bodykit/bmw-m3-e92/) · [Liberty Walk Shop — uyumlu yıllar ve kit içeriği](https://libertywalk.shop/body-kits/bmw/m3-works/) | Dosya adındaki Ver.2 kit adını doğrulama; kit motor verisi veya araç ağırlığını belirlemez |
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
| `BMW_M2_2025` | [BMW PressClub — 2025 BMW M2](https://www.press.bmwgroup.com/usa/article/detail/T0443102EN_US/new-2025-bmw-m2) · [BMW PressClub — 2025 M2 teknik verileri](https://www.press.bmwgroup.com/global/article/attachment/T0442878EN/617892) | 2.993 cc, 473 SAE hp, RWD; otomatikte 600 Nm, DIN ağırlığı şanzıman/ölçüm seçeneğine göre değişir |
| `BMW_M4_GTS_2016` | [BMW PressClub — The new BMW M4 GTS](https://www.press.bmwgroup.com/global/article/detail/T0236962EN/the-new-bmw-m4-gts) | 2016; 2.979 cc, 500 hp, 600 Nm, RWD, 1.510 kg DIN, 7 ileri M DCT, 305 km/sa |
| `BUGATTI_CHIRON_SS300` | [Bugatti Newsroom — Chiron Super Sport 300+ teknik özellikleri](https://newsroom.bugatti.com/en/models/chiron-super-sport-300) · [resmî teknik veri PDF'i](https://bugatti-newsroom.imgix.net/6673ecaebde16a1e54953017/technical-specifications-bugatti-chiron-super-sport-300-plus-en.pdf) | 7.993 cc W16, 1.600 hp, 1.600 Nm, AWD, 7 ileri DSG, 1.995 kg DIN; üretim aracının azami hızı 440 km/sa |
| `KOENIGSEGG_CC850` | [Koenigsegg — CC850 teknik özellikleri](https://www.koenigsegg.com/technical-specifications-cc850) · [CC850 model sayfası](https://www.koenigsegg.com/model/cc850) | 5.0 L V8, E85'te 1.385 hp/1.385 Nm, 1.385 kg; ESS ile 6 ileri manuel deneyimi ve 9 ileri LST |
| `KOENIGSEGG_REGERA` | [Koenigsegg — Regera teknik özellikleri](https://www.koenigsegg.com/technical-specifications-regera) | 5.0 L V8 hibrit, E85'te toplam 1.500 hp ve 2.000 Nm üzeri, KDD, 1.590 kg curb weight |
| `LAMBORGHINI_HURACAN_LP6104` | [Lamborghini — Huracán tarihçesi](https://www.lamborghini.com/cn-en/%E6%96%B0%E9%97%BB/huracan-revolution-a-story-of-technology-and-innovation) · [LP 610-4 fabrika teknik föyü](https://preview.thenewsmarket.com/Previews/lamb/DocumentAssets/321603.pdf) | 5.204 cc V10, 610 hp/CV pazar birimine göre, 560 Nm, AWD, 7 ileri LDF; oyun modeli için fabrika Coupé tabanı kullanıldı |
| `MCLAREN_720S` | [McLaren — 720S teknik özellikleri](https://cars.mclaren.com/us_en/legacy/720s) | 4.0 L V8, 720 PS/710 bhp, 770 Nm, 7 ileri SSG, RWD, 1.419 kg DIN, 341 km/sa |
| `MERCEDES_CLK_GTR` | [Mercedes-Benz Classic — CLK GTR tarihçesi](https://www.mercedes-benz.it/passengercars/brand/classic/auto-d-epoca/clk.html) · [ADAC — 1998 CLK GTR teknik verileri](https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/clk-gtr/297/350793/) · [HWA — 1998–2008 yıllık raporu](https://www.hwaag.com/images/PDFs/HWA_GB_english/HWAGB08e.pdf) | 1998 yol Coupé referansı: 6.898 cc V12, 612 PS, 731 Nm, RWD, 6 ileri; farklı yol/yarış sürümlerinde değerler değişir |
| `PAGANI_ZONDA_CINQUE` | [Pagani — Zonda Cinque](https://www.pagani.com/zonda-cinque/) | 7.3 L AMG V12, 678 CV, 780 Nm, 6 ileri sıralı, 1.210 kg kuru; üretim beş Coupé ile sınırlı |
| `PORSCHE_CARRERA_GT` | [Porsche Newsroom — Carrera GT teknik verileri](https://newsroom.porsche.com/en_US/products/porsche-klassik-20-years-carrera-gt-22859.html) · [Porsche Museum teknik kartı](https://newsroom.porsche.com/en/press-kits/Porsche-Museum/Porsche-Carrera-GT.html) | 2003–2006; 5.733 cc V10, 612 PS, 590 Nm, RWD, 6 ileri manuel, 1.380 kg, 330 km/sa |
| `TOYOTA_SUPRA_A80` | [Toyota Global — 1993 A80 Supra lansmanı](https://global.toyota/en/detail/7868203) | Japonya pazarı 2JZ-GTE turbo RZ/GZ referansı: 2.997 cc, 280 PS, 44,0 kgf·m (yaklaşık 431 Nm); turbo modellerde 6 ileri manuel veya otomatik seçeneği |

Üretimi sona ermiş araçlar ve gövde kiti sürümleri için Türkiye'de aynı model yılı, kondisyon ve donanımı temsil eden doğrulanabilir bir tekil güncel fiyat bulunmadığından gerçek piyasa fiyatı alanı doldurulmadı. Sadece M4 Competition için erişilebilir 2026 Türkiye liste fiyatı ayrı bir **referans** alanında tutulur; 2025 model varlığının birebir fiyatı olarak sunulmaz. Oyun fiyatları bundan bağımsız, oyunun başlangıç bakiyesi ve araç sınıfına göre ayarlanmıştır.

## Belirsizlikler

- `2014_m2_motoring_bmw_m3_e46.glb` yolundaki `2014` ibaresi otomobilin model yılı olarak doğrulanamadı; katalog yılı boş bırakır. Motor bilgisi yalnızca standart E46 M3 tabanına referanstır.
- 2025 M4 Competition dosyasında arkadan itiş ve M xDrive ayrımı seçilemiyor. Bu nedenle gerçek motor gücü, tahrik ve ağırlık alanları boş; 3,0 litre motor ve ortak tork değeri belirtilir.
- M4 GT3 EVO yarış aracında güç BoP ayarına göre değişir; üretici “590 hp'ye kadar” der. Tork/ağırlık için doğrulanmış değer yoktur.
- Modifiye Liberty Walk, M2 Motoring, Duke Dynamics ve Varis GLB'leri gövde görünümünü gösterir. Motor dönüşümü kanıtlanmadığından bu araçlarda fabrika tabanının teknik verileri referans kabul edilir ve notla işaretlenir.
- Renault, Mercedes ve Gallardo için erişilen üretici açıklamaları modelin motorunun bir kısmını doğrulasa da tüm ağırlık/şanzıman varyantlarını aynı sayfada açıklamıyor; doğrulanmayan alanlar boş bırakılır.
