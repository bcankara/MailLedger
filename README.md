# Mail Tarihçe Günlüğü (Thunderbird Eklentisi)

Gmail ve diğer e-posta hesaplarında Çöp Kutusu mailleri **silinme tarihine göre değil, orijinal gelme tarihine göre** sıraladığı için eski bir maili yanlışlıkla sildiğinizde bulmak zorlaşır.

**Mail Tarihçe Günlüğü**, **Thunderbird 128+ (Manifest V3)** için geliştirilmiş, sıfır harici bağımlılıklı ve tamamen yerel çalışan bir eklentidir. Gelen maillerin konu/gönderen bilgilerini, geliş tarihlerini ve silinme tarihlerini kaydeder; kendi tam arayüzü, hızlı açılır penceresi ve seçenekler ekranı üzerinden arama, sıralama ve tek tıkla geri yükleme imkânı sunar.

---

## Arayüz Bileşenleri (3 Ayrı Yüzey)

1. **Üst Araç Çubuğu Hızlı Penceresi (`ui/popup.html`):**
   - Eklenti simgesine tıklandığında anında açılır (rozet üzerinde Çöp Kutusu'ndaki kayıt sayısını gösterir).
   - Çöp Kutusu / Bugün Silinen / Toplam özetini, hızlı aramayı ve en son silinen mailleri tek tıkla **Aç** ve **Geri Yükle** düğmeleriyle sunar.
2. **Özel Tam Uygulama Arayüzü (`ui/dashboard.html` — Alanlar Çubuğu / Space):**
   - Sol gezinme menülü tam ekran Thunderbird sekmesi: **Silinenler**, **Tüm Mailler**, **İstatistikler**, **Tarama & Yedek** ve **Ayarlar**.
   - Türkçe karakter duyarlı (`İ/i/I/ı`) anlık arama, hesap ve durum filtreleri, **geliş veya silinme tarihine göre tarih aralığı filtresi**, tıklanabilir sıralamalı tablo sütunları.
   - **Toplu seçim çubuğu** (seçilenleri toplu geri yükle, CSV indir veya günlükten sil) ve sağdan açılan **Ayrıntı Çekmecesi** (tüm tarih damgaları, klasör geçmişi ve kopyalanabilir `Message-ID`).
   - **İstatistikler görünümü:** Son 14 gün günlük silme grafiği, hesap bazlı dağılım ve en çok silme yapılan klasörler.
   - **Tarama & Yedekleme:** Mevcut Gelen Kutusu ve Çöp Kutusu taraması, Türkçe Excel uyumlu **CSV (UTF-8 BOM)** dışa aktarımı, **JSON tam yedekleme** ve **JSON yedekten birleştirerek geri yükleme**.
3. **Thunderbird Eklenti Seçenekleri (`ui/options.html`):**
   - Eklentiler Yöneticisi içinden doğrudan izleme anahtarlarını, maksimum kayıt limitini, rozet sayacını ve tema tercihini (`Sistem / Açık / Koyu`) yönetme.

---

## Kurulum

### 1. Hazır `.xpi` Paketini İndirme
Bu deponun **[Releases](../../releases)** sayfasından en güncel `mail-tarihce-gunlugu.xpi` dosyasını indirin (veya kaynak koddan kendiniz oluşturun).

### 2. Thunderbird'e Yükleme
1. Thunderbird'ü açın ve **`Ctrl + Shift + A`** kısayolu ile **Eklentiler ve Temalar** sekmesine geçin.
2. Sağ üstteki **dişli simgesine** tıklayıp **Dosyadan eklenti kur...** (*Install Add-on From File...*) seçeneğini seçin.
3. İndirdiğiniz `mail-tarihce-gunlugu.xpi` dosyasını seçip onaylayın (**Ekle**).
4. Sol taraftaki **Alanlar (Spaces)** çubuğundan **Mail Tarihçe** sekmesini veya üst araç çubuğundaki eklenti simgesini kullanabilirsiniz.

---

## Kapsam ve Gizlilik Notu
* **%100 Yerel Çalışma:** Eklenti hiçbir dış sunucuya veri göndermez. Tüm kayıtlar yalnızca Thunderbird'ün yerel `storage.local` alanında tutulur ve e-posta gövdeleri değil yalnızca üstbilgi (konu, gönderen, tarih, klasör, `Message-ID`) saklanır.
* **Eski Maillerde Silme Takibi:** Eklenti kurulmadan yıllar önce gelmiş bir maili kurulum sonrası sildiğinizde, orijinal geliş tarihini koruyarak tam silinme anını kaydeder.
* **Kurulum Öncesi Çöp Kutusu:** *Çöp Kutularını Tara* aracı, kurulumdan önce silinmiş mailler için uydurma silinme tarihi yazmaz; bu kayıtları **Kurulum öncesi** etiketiyle listeler.

---

## Geliştirme, Test ve Paketleme

Gereksinimler: **Node.js 22+** (testler ve söz dizimi kontrolü için) ve **Python 3.10+** (`.xpi` paketlemek için). Harici `npm` veya `pip` paketi gerekmez.

```bash
# 1. Tüm JS dosyalarında söz dizimi kontrolü
npm run check

# 2. Birim ve entegrasyon testleri
npm test

# 3. Thunderbird .xpi paketini oluşturma ve doğrulama
npm run build
```

Oluşturulan paket `dist/mail-tarihce-gunlugu.xpi` yoluna kaydedilir.

## Lisans
[MIT](LICENSE)
