/**
 * Contrabas — API сайту (Google Apps Script). Версія 3.
 * Дії: list / add / update / delete (кейси), lead (заявки з форми),
 *      site (про-нас + контакти), update_about, update_contacts.
 * Обмін через JSONP (?callback=) — без CORS.
 *
 * Листи (створюються скриптом автоматично, якщо їх немає):
 *   cases    — кейси портфоліо (як і раніше)
 *   about    — текст секції "Про нас" (укр/англ)
 *   contacts — телефон / email / адреса / соцмережі (для футера й контактів)
 *   leads    — заявки з форми «Обговорити проєкт»
 *
 * КІЛЬКА ВІДЕО В ОДНОМУ КЕЙСІ:
 *   Усі ролики кейсу приходять у полі `reels` — по одному посиланню на рядок
 *   (розділювач — новий рядок або кома). Перше посилання — головне (обкладинка):
 *   воно ж дублюється в `video_url` для прев’ю/OG.
 *
 * ЗАГОЛОВКИ В ОПИСІ КЕЙСУ (desc_uk / desc_en):
 *   Рядок виду *Заголовок* стає червоним підзаголовком, весь текст під ним —
 *   звичайний опис (аж до наступного *Заголовка*). Приклад:
 *     *Задача*
 *     Клієнт хотів...
 *     *Наше рішення*
 *     Створили серію...
 *   Парсинг — на боці сайту (JS), тут текст зберігається як є.
 *
 * ВАЖЛИВО: усі листи працюють за ІМЕНАМИ стовпців (рядок 1), а не за позицією.
 * Порядок стовпців НЕ важливий; відсутні заголовки скрипт додасть сам.
 *
 * ⚠ Після заміни цього коду ОБОВʼЯЗКОВО перерозгорни веб-застосунок:
 *   Deploy → Manage deployments → (олівець) Edit → Version: New version → Deploy.
 *   URL лишається той самий.
 *   Первинне розгортання: Deploy → New deployment → Web app →
 *   Execute as: Me,  Who has access: Anyone.
 */

/* ---------- Листи й заголовки ---------- */
var SHEET_CASES      = 'cases';
var SHEET_ABOUT      = 'about';
var SHEET_CONTACTS   = 'contacts';
var SHEET_LEADS      = 'leads';
var SHEET_HERO       = 'hero';        // заголовок/опис hero + заголовок секції «Що ми робимо»
var SHEET_CATEGORIES = 'categories';  // список категорій проєктів (керує hero + фільтрами)
var SHEET_SERVICES   = 'services';    // картки секції «Що ми робимо» (тег/назва/опис/фільтр)
var SHEET_SETTINGS   = 'settings';    // службові налаштування (пароль адмінки)
var IMAGES_FOLDER    = 'Contrabas site images'; // папка на Google Drive для завантажених фото (hero/про нас)

// Заявки з форми «Обговорити проєкт» ЗАВЖДИ дублюються на цю пошту (незалежно
// від того, яка пошта показана публічно на сайті в блоці «Контакти»).
var ADMIN_NOTIFY_EMAIL = 'vladpetrenko66@gmail.com';

var HEADERS = ['id','created_at','name_uk','name_en','category','year','placement',
               'provider','video_id','video_url','thumb','desc_uk','desc_en','reels'];
var EDITABLE = ['name_uk','name_en','category','year','placement',
                'provider','video_id','video_url','thumb','desc_uk','desc_en','reels'];

var ABOUT_HEADERS      = ['key','value_uk','value_en'];
var CONTACTS_HEADERS   = ['key','value'];
var LEADS_HEADERS      = ['created_at','name','contact','message','lang','page'];
var HERO_HEADERS       = ['key','value_uk','value_en'];
var CATEGORIES_HEADERS = ['name'];
var SERVICES_HEADERS   = ['tag_uk','tag_en','name_uk','name_en','desc_uk','desc_en','filter'];
var SETTINGS_HEADERS   = ['key','value'];
var ADMIN_PASSWORD_DEFAULT = '1111';

/* Ключі листа `hero` (key/value_uk/value_en). Крім hero-заголовка й опису тут
   лежить і заголовок секції «Що ми робимо» (services_eyebrow / services_title). */
var HERO_KEYS = {
  title:            { uk: 'Креативний\nвідеопродакшн\nдля брендів', en: 'Creative\nProduction\nfor Brands' },
  lead:             { uk: 'Створюємо відео та контент, що привертає увагу, підсилює бренди і працює на результат.',
                      en: 'We create video and content that grabs attention, strengthens brands and drives results.' },
  services_eyebrow: { uk: 'Що ми робимо', en: 'What we do' },
  services_title:   { uk: 'Відеопродакшн\nта контент\nповного циклу', en: 'Full-service\nvideo production\n& content' },
  // URL фотографій hero-фону та секції «Про нас». Порожньо = лишається дефолтне фото
  // з HTML (сайт нічого не перезаписує, поки в таблиці немає значення).
  hero_photo:       { uk: '', en: '' },
  about_photo:      { uk: '', en: '' },
  // Посилання на відео кнопки «Дивитись шоуріл» у hero (Vimeo/YouTube). uk/en
  // однакові — відео не залежить від мови.
  showreel_url:     { uk: 'https://vimeo.com/784082737', en: 'https://vimeo.com/784082737' }
};

/* Стартовий список категорій (як у ТЗ). Далі керується з адмінпанелі/таблиці. */
var CATEGORIES_DEFAULTS = ['Commercial', 'Social Content', 'Podcasts', 'YouTube', 'Documentary'];

/* Стартові картки секції «Що ми робимо» (як у ТЗ). filter — категорія для лінка «Дивитись роботи». */
var SERVICES_DEFAULTS = [
  { tag_uk: 'Commercial', tag_en: 'Commercial', name_uk: 'Production', name_en: 'Production',
    desc_uk: 'Рекламні ролики, бренд-фільми, корпоративне відео та інші кінематографічні проєкти будь-якої складності.',
    desc_en: 'Commercials, brand films, corporate video and other cinematic projects of any complexity.', filter: 'Commercial' },
  { tag_uk: 'Social Content', tag_en: 'Social Content', name_uk: 'Content Studio', name_en: 'Content Studio',
    desc_uk: 'Вертикальний контент, Reels, TikTok, YouTube, подкасти та контент під ключ для соцмереж і рекламних кампаній.',
    desc_en: 'Vertical content, Reels, TikTok, YouTube, podcasts and turnkey content for social media and ad campaigns.', filter: 'Social Content' },
  { tag_uk: 'Creative', tag_en: 'Creative', name_uk: 'Creative', name_en: 'Creative',
    desc_uk: 'Креативні ідеї, сценарії, сторітелінг та концепції кампаній, що допомагають брендам бути помітними.',
    desc_en: 'Creative ideas, scripts, storytelling and campaign concepts that help brands stand out.', filter: 'all' }
];

/* Стартові значення — підставляються один раз при першому створенні листа,
   далі все редагується або з сайту (адмінпанель), або прямо в таблиці. */
var ABOUT_DEFAULTS = {
  uk: "Ми — команда професіоналів, закоханих у відео та свою справу. Створюємо сильні візуальні історії для брендів і компаній в Україні та за її межами.\n\nУ 2024 році нашу студію було знищено внаслідок російської атаки. Ми втратили приміщення, але не втратили команду та бажання створювати сильні проєкти. Contrabas — це про стійкість, креатив та людей, які роблять більше, ніж очікують.",
  en: "We are a team of professionals in love with video and our craft. We create strong visual stories for brands and companies in Ukraine and beyond.\n\nIn 2024 our studio was destroyed as a result of a russian attack. We lost our premises, but not our team or our drive to create strong projects. Contrabas is about resilience, creativity and people who do more than expected."
};
var CONTACTS_DEFAULTS = {
  phone: '+380962836900',
  phone_display: '+38 096 283 69 00',
  manager: 'Руслан Тесленко',
  email: 'contrabasvideo@gmail.com',
  address_uk: 'м. Дніпро, вул. Телевізійна, 3, Україна, 49010',
  address_en: 'Dnipro, Televiziina St, 3, Ukraine, 49010',
  telegram: 'https://t.me/contrabasvideo',
  instagram: 'https://www.instagram.com/contrabas__video/',
  youtube: 'https://www.youtube.com/channel/UCswZGoXj28dcmqR9uB-xR-Q',
  vimeo: 'https://vimeo.com/user38440932',
  facebook: 'https://www.facebook.com/contrabas.video.prod'
};

function doGet(e)  { return handle_(e); }
function doPost(e) { return handle_(e); }

function handle_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  // POST із JSON-тілом (напр. завантаження фото — воно завелике для GET/JSONP).
  // Розбираємо body у ті самі параметри, щоб решта коду працювала без змін.
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      if (body && typeof body === 'object') {
        Object.keys(body).forEach(function (k) { p[k] = body[k]; });
      }
    } catch (er) { /* не JSON — ігноруємо, лишаються query-параметри */ }
  }
  var callback = p.callback || '';
  var action = p.action || 'list';
  var out;
  try {
    if      (action === 'add')               out = addCase_(p);
    else if (action === 'update')            out = updateCase_(p);
    else if (action === 'delete')            out = deleteCase_(p);
    else if (action === 'lead')              out = addLead_(p);
    else if (action === 'site')              out = getSite_();
    else if (action === 'update_about')      out = updateAbout_(p);
    else if (action === 'update_contacts')   out = updateContacts_(p);
    else if (action === 'update_hero')       out = updateHero_(p);
    else if (action === 'update_categories') out = updateCategories_(p);
    else if (action === 'update_services')   out = updateServices_(p);
    else if (action === 'upload_image')      out = uploadImage_(p);
    else if (action === 'check_password')    out = checkPassword_(p);
    else if (action === 'update_password')   out = updatePassword_(p);
    else                                     out = { ok: true, items: listCases_() };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  var json = JSON.stringify(out);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   Завантаження фото (drag & drop у адмінці).
   Сайт надсилає POST з base64 картинки; тут зберігаємо файл у папку на Google
   Drive, робимо його публічним і повертаємо пряме посилання для <img src>.
   ⚠ Перший виклик попросить дозвіл на Google Drive — підтвердь своїм акаунтом.
   ============================================================ */
function uploadImage_(p) {
  if (!p || !p.data) return { ok: false, error: 'no image data' };
  var mime = p.mime || 'image/jpeg';
  var ext  = (mime === 'image/png') ? '.png' : (mime === 'image/webp') ? '.webp' : '.jpg';
  var name = (p.name ? String(p.name).replace(/[^\w\-]+/g, '_') : 'photo') + '_' + Date.now() + ext;
  var bytes = Utilities.base64Decode(p.data);
  var blob  = Utilities.newBlob(bytes, mime, name);
  var folder = getImagesFolder_();
  var file = folder.createFile(blob);
  // Робимо доступним «усім, у кого є посилання» — інакше фото не покажеться на сайті.
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  var id = file.getId();
  // Пряме посилання на зображення через googleusercontent (надійно працює в <img>).
  // =w2400 — максимальна ширина (фото вже стиснуте на клієнті, тож не збільшується).
  return { ok: true, id: id, url: 'https://lh3.googleusercontent.com/d/' + id + '=w2400' };
}

function getImagesFolder_() {
  var it = DriveApp.getFoldersByName(IMAGES_FOLDER);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(IMAGES_FOLDER);
}

/* ============================================================
   Спільний хелпер: гарантує лист + наявність усіх колонок заголовків
   (додає відсутні в кінець, не займаючи наявних даних).
   ============================================================ */
function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var lastCol = sh.getLastColumn();
  var have = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); }) : [];
  if (have.length === 0 || have.join('') === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length) {
      sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  }
  return sh;
}

/* Мапа: назва_заголовка -> 0-based індекс стовпця (за фактичним рядком 1). */
function headerMap_(sh) {
  var lastCol = sh.getLastColumn();
  var row = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < row.length; i++) {
    var k = String(row[i]).trim();
    if (k && map[k] === undefined) map[k] = i;
  }
  return map;
}

/* ============================================================
   КЕЙСИ (cases) — як і раніше, без змін логіки
   ============================================================ */
function getSheet_() { return getOrCreateSheet_(SHEET_CASES, HEADERS); }

function listCases_() {
  var sh = getSheet_();
  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 2) return [];
  var map = headerMap_(sh);
  var values = sh.getRange(2, 1, last - 1, lastCol).getValues();
  var items = values.map(function (r) {
    var o = {};
    HEADERS.forEach(function (h) {
      var idx = map[h];
      o[h] = (idx !== undefined && idx < r.length) ? r[idx] : '';
    });
    if (o.created_at instanceof Date) o.created_at = o.created_at.toISOString();
    return o;
  }).filter(function (o) { return o.id || o.name_uk || o.video_url; });
  items.reverse();
  return items;
}

/* Нормалізує список роликів: рядки/коми -> масив, обрізає пробіли,
   прибирає порожні та дублікати. Повертає рядок (по одному посиланню на рядок). */
function normalizeReels_(raw) {
  if (!raw) return '';
  var parts = String(raw).split(/[\r\n,]+/);
  var seen = {}, out = [];
  for (var i = 0; i < parts.length; i++) {
    var u = parts[i].trim();
    if (u && !seen[u]) { seen[u] = true; out.push(u); }
  }
  return out.join('\n');
}
function firstReel_(reels) {
  var s = normalizeReels_(reels);
  return s ? s.split('\n')[0] : '';
}

function addCase_(p) {
  if (!p.name_uk) throw new Error('name_uk is required');
  var reels = normalizeReels_(p.reels);
  var mainUrl = p.video_url || firstReel_(reels);
  if (!mainUrl) throw new Error('video_url is required');

  var sh = getSheet_();
  var map = headerMap_(sh);
  var lastCol = sh.getLastColumn();
  var id = 'c' + Date.now() + Math.floor(Math.random() * 1000);
  var vals = {
    id: id, created_at: new Date(),
    name_uk: p.name_uk || '', name_en: p.name_en || '', category: p.category || '',
    year: p.year || '', placement: p.placement || '', provider: p.provider || '',
    video_id: p.video_id || '', video_url: mainUrl, thumb: p.thumb || '',
    desc_uk: p.desc_uk || '', desc_en: p.desc_en || '', reels: reels
  };
  var row = [];
  for (var i = 0; i < lastCol; i++) row.push('');
  Object.keys(vals).forEach(function (k) { var idx = map[k]; if (idx !== undefined) row[idx] = vals[k]; });
  sh.appendRow(row);
  return { ok: true, id: id };
}

function findRowNum_(sh, map, id) {
  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 2) return -1;
  var idIdx = map['id'];
  if (idIdx === undefined) return -1;
  var data = sh.getRange(2, 1, last - 1, lastCol).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(id)) return i + 2;
  }
  return -1;
}

function updateCase_(p) {
  if (!p.id) throw new Error('id is required');
  var sh = getSheet_();
  var map = headerMap_(sh);
  var lastCol = sh.getLastColumn();
  var rowNum = findRowNum_(sh, map, p.id);
  if (rowNum < 0) throw new Error('case not found: ' + p.id);
  var cur = sh.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  EDITABLE.forEach(function (k) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '__keep__') {
      var val = (k === 'reels') ? normalizeReels_(p[k]) : p[k];
      var idx = map[k]; if (idx !== undefined) cur[idx] = val;
    }
  });
  if (p.reels !== undefined && (p.video_url === undefined || p.video_url === '')) {
    var vIdx = map['video_url'], first = firstReel_(p.reels);
    if (vIdx !== undefined && first) cur[vIdx] = first;
  }
  sh.getRange(rowNum, 1, 1, lastCol).setValues([cur]);
  return { ok: true, id: p.id };
}

function deleteCase_(p) {
  if (!p.id) throw new Error('id is required');
  var sh = getSheet_();
  var map = headerMap_(sh);
  var rowNum = findRowNum_(sh, map, p.id);
  if (rowNum < 0) throw new Error('case not found: ' + p.id);
  sh.deleteRow(rowNum);
  return { ok: true, id: p.id };
}

/* ============================================================
   "ПРО НАС" (about) — один рядок з ключем 'about', укр/англ текст
   ============================================================ */
function getAbout_() {
  var sh = getOrCreateSheet_(SHEET_ABOUT, ABOUT_HEADERS);
  var last = sh.getLastRow();
  var row = null;
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, ABOUT_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === 'about') { row = data[i]; break; }
    }
  }
  if (!row) {
    sh.appendRow(['about', ABOUT_DEFAULTS.uk, ABOUT_DEFAULTS.en]);
    row = ['about', ABOUT_DEFAULTS.uk, ABOUT_DEFAULTS.en];
  }
  return {
    uk: row[1] || ABOUT_DEFAULTS.uk,
    en: row[2] || ABOUT_DEFAULTS.en
  };
}

function updateAbout_(p) {
  var sh = getOrCreateSheet_(SHEET_ABOUT, ABOUT_HEADERS);
  var last = sh.getLastRow();
  var rowNum = -1;
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === 'about') { rowNum = i + 2; break; }
    }
  }
  var uk = p.text_uk !== undefined ? p.text_uk : ABOUT_DEFAULTS.uk;
  var en = p.text_en !== undefined ? p.text_en : ABOUT_DEFAULTS.en;
  if (rowNum < 0) {
    sh.appendRow(['about', uk, en]);
  } else {
    if (p.text_uk !== undefined) sh.getRange(rowNum, 2).setValue(p.text_uk);
    if (p.text_en !== undefined) sh.getRange(rowNum, 3).setValue(p.text_en);
  }
  return { ok: true };
}

/* ============================================================
   КОНТАКТИ (contacts) — рядки key/value: телефон, email, адреса, соцмережі.
   Використовуються і в футері, і в блоці «Контакти».
   ============================================================ */
function getContacts_() {
  var sh = getOrCreateSheet_(SHEET_CONTACTS, CONTACTS_HEADERS);
  var last = sh.getLastRow();
  var out = {};
  Object.keys(CONTACTS_DEFAULTS).forEach(function (k) { out[k] = CONTACTS_DEFAULTS[k]; });

  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, 2).getValues();
    var seen = {};
    data.forEach(function (r) {
      var k = String(r[0]).trim();
      if (k) { out[k] = (r[1] === '' || r[1] === undefined || r[1] === null) ? out[k] : r[1]; seen[k] = true; }
    });
    var toAdd = Object.keys(CONTACTS_DEFAULTS).filter(function (k) { return !seen[k]; });
    if (toAdd.length) {
      var rows = toAdd.map(function (k) { return [k, CONTACTS_DEFAULTS[k]]; });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
    }
  } else {
    var seedRows = Object.keys(CONTACTS_DEFAULTS).map(function (k) { return [k, CONTACTS_DEFAULTS[k]]; });
    sh.getRange(2, 1, seedRows.length, 2).setValues(seedRows);
  }
  return out;
}

function updateContacts_(p) {
  var sh = getOrCreateSheet_(SHEET_CONTACTS, CONTACTS_HEADERS);
  getContacts_(); // гарантує що лист уже засіяний дефолтними ключами
  var last = sh.getLastRow();
  var map = {};
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) map[String(data[i][0]).trim()] = i + 2;
  }
  Object.keys(CONTACTS_DEFAULTS).forEach(function (k) {
    if (p[k] === undefined) return;
    if (map[k]) sh.getRange(map[k], 2).setValue(p[k]);
    else { sh.appendRow([k, p[k]]); map[k] = sh.getLastRow(); }
  });
  return { ok: true };
}

/* ============================================================
   HERO (hero) — заголовок/опис hero + заголовок секції «Що ми робимо».
   Рядки key/value_uk/value_en. Ключі — з HERO_KEYS.
   Повертає плаский обʼєкт: { <key>_uk, <key>_en, ... }.
   ============================================================ */
function getHero_() {
  var sh = getOrCreateSheet_(SHEET_HERO, HERO_HEADERS);
  var last = sh.getLastRow();
  var map = {};
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, HERO_HEADERS.length).getValues();
    data.forEach(function (r) { var k = String(r[0]).trim(); if (k) map[k] = { uk: r[1], en: r[2] }; });
  }
  // Засіваємо відсутні ключі дефолтами (щоб на сайті не було порожньо).
  var toAdd = [];
  Object.keys(HERO_KEYS).forEach(function (k) {
    if (!map[k]) { map[k] = { uk: HERO_KEYS[k].uk, en: HERO_KEYS[k].en }; toAdd.push([k, HERO_KEYS[k].uk, HERO_KEYS[k].en]); }
  });
  if (toAdd.length) sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, 3).setValues(toAdd);
  var out = {};
  Object.keys(HERO_KEYS).forEach(function (k) {
    out[k + '_uk'] = (map[k] && map[k].uk) || HERO_KEYS[k].uk;
    out[k + '_en'] = (map[k] && map[k].en) || HERO_KEYS[k].en;
  });
  return out;
}

function updateHero_(p) {
  var sh = getOrCreateSheet_(SHEET_HERO, HERO_HEADERS);
  getHero_(); // гарантує, що всі ключі вже є
  var last = sh.getLastRow();
  var rowByKey = {};
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) rowByKey[String(data[i][0]).trim()] = i + 2;
  }
  function set(key, uk, en) {
    var rn = rowByKey[key];
    if (rn) {
      if (uk !== undefined) sh.getRange(rn, 2).setValue(uk);
      if (en !== undefined) sh.getRange(rn, 3).setValue(en);
    } else {
      sh.appendRow([key, uk || '', en || '']);
      rowByKey[key] = sh.getLastRow();
    }
  }
  // Оновлюємо будь-який ключ HERO_KEYS, якщо передано <key>_uk / <key>_en.
  Object.keys(HERO_KEYS).forEach(function (k) {
    if (p[k + '_uk'] !== undefined || p[k + '_en'] !== undefined) set(k, p[k + '_uk'], p[k + '_en']);
  });
  return { ok: true };
}

/* ============================================================
   SERVICES (services) — картки секції «Що ми робимо».
   Стовпці: tag_uk, tag_en, name_uk, name_en, desc_uk, desc_en, filter.
   ============================================================ */
function getServices_() {
  var sh = getOrCreateSheet_(SHEET_SERVICES, SERVICES_HEADERS);
  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  var list = [];
  if (last >= 2) {
    var map = headerMap_(sh);
    var values = sh.getRange(2, 1, last - 1, lastCol).getValues();
    values.forEach(function (r) {
      var o = {};
      SERVICES_HEADERS.forEach(function (h) { var idx = map[h]; o[h] = (idx !== undefined && idx < r.length) ? r[idx] : ''; });
      if (o.name_uk || o.tag_uk || o.desc_uk) list.push(o);
    });
  }
  // Порожній лист — засіваємо дефолтними картками.
  if (!list.length) {
    var rows = SERVICES_DEFAULTS.map(function (s) {
      return SERVICES_HEADERS.map(function (h) { return s[h] || ''; });
    });
    sh.getRange(2, 1, rows.length, SERVICES_HEADERS.length).setValues(rows);
    list = SERVICES_DEFAULTS.slice();
  }
  return list;
}

function updateServices_(p) {
  var sh = getOrCreateSheet_(SHEET_SERVICES, SERVICES_HEADERS);
  // p.services — JSON-масив карток. Порожні (без назви) прибираємо.
  var list = [];
  try { list = JSON.parse(p.services || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  var clean = list.filter(function (s) { return s && (s.name_uk || s.tag_uk); });
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, SERVICES_HEADERS.length).clearContent();
  if (clean.length) {
    var rows = clean.map(function (s) { return SERVICES_HEADERS.map(function (h) { return (s[h] == null) ? '' : s[h]; }); });
    sh.getRange(2, 1, rows.length, SERVICES_HEADERS.length).setValues(rows);
  }
  return { ok: true, services: clean };
}

/* ============================================================
   ПАРОЛЬ АДМІНКИ (settings) — один рядок key='admin_password'.
   Пароль НІКОЛИ не повертається в жодній відповіді (навіть у getSite_) —
   лише перевіряється на бекенді за дією check_password, щоб його не було
   видно через мережеву вкладку браузера.
   ============================================================ */
function getAdminPasswordRow_() {
  var sh = getOrCreateSheet_(SHEET_SETTINGS, SETTINGS_HEADERS);
  var last = sh.getLastRow();
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === 'admin_password') return { sh: sh, rowNum: i + 2, value: String(data[i][1]) };
    }
  }
  var rowNum = sh.getLastRow() + 1;
  // Стовпець B — примусово ТЕКСТ. Без цього Google Таблиця сама перетворює
  // цифровий пароль (напр. "0000") на число 0, губимо ведучі нулі — і пароль
  // перестає збігатися.
  sh.getRange(rowNum, 2).setNumberFormat('@');
  sh.getRange(rowNum, 1, 1, 2).setValues([['admin_password', ADMIN_PASSWORD_DEFAULT]]);
  return { sh: sh, rowNum: rowNum, value: ADMIN_PASSWORD_DEFAULT };
}

function checkPassword_(p) {
  var cur = getAdminPasswordRow_().value || ADMIN_PASSWORD_DEFAULT;
  var ok = String(p.password || '') === cur;
  return { ok: ok };
}

function updatePassword_(p) {
  var row = getAdminPasswordRow_();
  var cur = row.value || ADMIN_PASSWORD_DEFAULT;
  if (String(p.current_password || '') !== cur) return { ok: false, error: 'Поточний пароль невірний' };
  var next = String(p.new_password || '').trim();
  if (!next) return { ok: false, error: 'Новий пароль порожній' };
  // Примусово текстовий формат перед записом — щоб "0000" тощо не ставало числом.
  row.sh.getRange(row.rowNum, 2).setNumberFormat('@').setValue(next);
  return { ok: true };
}

/* Усі блоки одразу (включно з кейсами!) — сайт при першому завантаженні робить
   ОДИН виклик замість двох (site + list) — так швидше, менше затримки. */
function getSite_() {
  return {
    ok: true,
    about: getAbout_(),
    contacts: getContacts_(),
    hero: getHero_(),
    categories: getCategories_(),
    services: getServices_(),
    cases: listCases_()
  };
}

/* ============================================================
   КАТЕГОРІЇ (categories) — один стовпець «name», по одному рядку на категорію.
   Керують і списком напрямків у hero, і фільтрами кейсів, і випадайкою у формі.
   ============================================================ */
function getCategories_() {
  var sh = getOrCreateSheet_(SHEET_CATEGORIES, CATEGORIES_HEADERS);
  var last = sh.getLastRow();
  var list = [];
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, 1).getValues();
    var seen = {};
    data.forEach(function (r) {
      var v = String(r[0]).trim();
      if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = true; list.push(v); }
    });
  }
  // Порожній лист — засіваємо дефолтами (щоб hero/фільтри не були порожні).
  if (!list.length) {
    var rows = CATEGORIES_DEFAULTS.map(function (c) { return [c]; });
    sh.getRange(2, 1, rows.length, 1).setValues(rows);
    list = CATEGORIES_DEFAULTS.slice();
  }
  return list;
}

function updateCategories_(p) {
  var sh = getOrCreateSheet_(SHEET_CATEGORIES, CATEGORIES_HEADERS);
  // p.categories — список через новий рядок або кому. Порожні прибираємо, дублікати теж.
  var raw = p.categories || '';
  var parts = String(raw).split(/[\r\n]+/);
  var seen = {}, list = [];
  for (var i = 0; i < parts.length; i++) {
    var v = parts[i].trim();
    if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = true; list.push(v); }
  }
  // Повністю перезаписуємо лист (окрім рядка-заголовка).
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 1).clearContent();
  if (list.length) sh.getRange(2, 1, list.length, 1).setValues(list.map(function (c) { return [c]; }));
  return { ok: true, categories: list };
}

/* ============================================================
   ЗАЯВКИ (leads) — форма «Обговорити проєкт» / контакти
   ============================================================ */
function addLead_(p) {
  var sh = getOrCreateSheet_(SHEET_LEADS, LEADS_HEADERS);
  sh.appendRow([new Date(), p.name || '', p.contact || p.email || '', p.message || '', p.lang || '', p.page || '']);
  // Лист-сповіщення. ЗАВЖДИ йде на ADMIN_NOTIFY_EMAIL (фіксована пошта власника),
  // + додатково на публічну пошту з таблиці «contacts», якщо вона інша.
  try {
    var body = 'Ім\'я: ' + (p.name || '') + '\n' +
               'Контакт: ' + (p.contact || p.email || '') + '\n' +
               'Повідомлення: ' + (p.message || '') + '\n' +
               'Мова: ' + (p.lang || '') + '\n' +
               'Сторінка: ' + (p.page || '');
    var recipients = [ADMIN_NOTIFY_EMAIL];
    var contacts = getContacts_();
    var publicEmail = contacts.email || CONTACTS_DEFAULTS.email;
    if (publicEmail && publicEmail.toLowerCase() !== ADMIN_NOTIFY_EMAIL.toLowerCase()) recipients.push(publicEmail);
    MailApp.sendEmail({
      to: recipients.join(','),
      subject: 'Нова заявка з сайту Contrabas',
      body: body
    });
  } catch (mailErr) { /* тихо ігноруємо — заявка вже збережена в таблиці */ }
  return { ok: true };
}
