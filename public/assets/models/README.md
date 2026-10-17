# Araç GLB modelleri

Araç GLB dosyaları `GLB/` altındaki marka/model klasörlerinde tutulur. Dosya yolları korunur. Mağazaya bağlı model kimlikleri bu klasörün bir üstündeki `manifest.json` içinde yer alır.

Mevcut araç kataloğu, oyun fiyatları ve gerçek araç referansları `src/data.ts` dosyasında tek merkezden yönetilir. Modelleri, düğüm/tekerlek yapısını, veri kaynaklarını ve bilinmeyen alanları incelemek için [`VEHICLE-RESEARCH.md`](VEHICLE-RESEARCH.md) dosyasına bakın. GLB modelleri gerektiğinde yüklenir; tamamı oyun açılışında belleğe alınmaz.
