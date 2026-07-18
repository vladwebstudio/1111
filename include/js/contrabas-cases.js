/* ============================================================
   Contrabas — кейси: Google Sheets як бекенд + модальні вікна
   (керування: додати/редагувати/видалити; перегляд: відео + опис кейсу).
   Обмін через JSONP => без CORS, працює локально.
   Секцію оформлено як «SELECTED PROJECTS» (референс, dark premium).
   ============================================================ */
(function () {
  'use strict';

  // === ЄДИНЕ, що змінюєш при переразгортанні скрипта ===
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbwI2_M7eA8jvuwRpk-gCHYi4KhiPCAkrXbkMoSQRXpv5Jtgzsm_BgrTgw2cWHu8DZax/exec';

  /* Кеш останньої відповіді Google Таблиці в localStorage: при повторному заході
     сторінка одразу показує РЕАЛЬНІ дані (кейси/тексти/фото) з кешу, без «мигання»
     статичного тексту з HTML, а вже потім тихо звіряється з таблицею у фоні. */
  var CACHE_PREFIX = 'cx_cache_v1_';
  function cacheGet(key) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function cacheSet(key, data) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)); } catch (e) { /* сховище недоступне — не критично */ }
  }

  /* ---------------- Loading-гейт (лише на САМИЙ ПЕРШИЙ візит) ----------------
     Якщо кешу ще немає (перший раз на цьому пристрої) — показуємо повноекранний
     екран завантаження і БЛОКУЄМО взаємодію із сайтом, поки не прийде відповідь
     з Google Таблиці (кейси + hero/про нас/контакти/категорії/послуги). Далі —
     кеш є, і при кожному наступному заході сайт відкривається миттєво з кешу,
     без цього екрана, а свіжі дані підтягуються тихо у фоні. */
  // «Чесний» відсоток тут неможливий — Apps Script віддає відповідь одним
  // шматком, без проміжних подій прогресу. Тому імітуємо: швидко до ~40%,
  // далі сповільнюючись до ~92% (типова крива «завантаження», як у браузерів),
  // а на реальній відповіді одразу стрибаємо на 100% і ховаємо екран.
  var gateTimer = null, gatePct = 0;
  function gateSetPct(v) {
    gatePct = v;
    var bar = document.getElementById('cx-gate-bar');
    var pct = document.getElementById('cx-gate-pct');
    if (bar) bar.style.width = v + '%';
    if (pct) pct.textContent = Math.round(v) + '%';
  }
  function showLoadingGate() {
    var g = document.getElementById('cx-gate');
    if (!g) return;
    var msg = document.getElementById('cx-gate-msg');
    var sub = document.getElementById('cx-gate-sub');
    if (msg) msg.textContent = T.gateMsg;
    if (sub) sub.textContent = T.gateSub;
    gateSetPct(0);
    if (gateTimer) clearInterval(gateTimer);
    gateTimer = setInterval(function () {
      // Жорсткий стоп на 92% — БЕЗ цього крок нижче (Math.max(0.5, …)) ніколи
      // не стає нулем і продовжує додавати мінімум 0.5% на кожен тик і після
      // 92%, тому при повільній мережі лічильник ліз за 100/120/150% і вище.
      // Далі — лише 100% на реальній відповіді (hideLoadingGate).
      if (gatePct >= 92) return;
      var remaining = 92 - gatePct;
      gateSetPct(Math.min(92, gatePct + Math.max(0.5, remaining * 0.09)));
    }, 70);
    g.classList.add('is-visible');
    document.body.classList.add('no-scroll');
  }
  function hideLoadingGate() {
    var g = document.getElementById('cx-gate');
    if (!g) return;
    if (gateTimer) { clearInterval(gateTimer); gateTimer = null; }
    gateSetPct(100);
    setTimeout(function () {
      g.classList.remove('is-visible');
      document.body.classList.remove('no-scroll');
    }, 200);
  }

  var LANG = /eng\.html/i.test(location.pathname) ? 'en' : 'uk';
  // Порожньо за замовчуванням — категорії завжди з Google Таблиці, без «фейкових»
  // значень з коду. Порожнім лишається лише на дуже перший візит, поки триває
  // перше завантаження (є повноекранний loading-гейт — взаємодія заблокована,
  // доки таблиця не відповість, тож форма «Додати кейс» на практиці ніколи не
  // відкриється з порожнім CATEGORIES; про всяк випадок форма також має свій
  // текстовий fallback, якщо категорій немає — див. screenForm()).
  var CATEGORIES = [];

  var T = {
    uk: {
      heading: 'Наші роботи', eyebrow: 'Наші кейси',
      sub: 'Кейси зберігаються у Google Таблиці — керуйте ними без програміста',
      manage: 'Керувати кейсами', all: 'Всі', watch: 'Дивитись', openCase: 'Дивитись кейс',
      empty: 'Поки що немає кейсів.', loading: 'Завантаження…',
      loadErr: 'Помилка звʼязку. Перевір розгортання скрипта.',
      chooseTitle: 'Що зробити?', chooseAdd: 'Додати кейс', chooseAddSub: 'Новий кейс у портфоліо',
      chooseEdit: 'Редагувати кейси', chooseEditSub: 'Змінити або видалити наявні',
      addTitle: 'Новий кейс', editTitle: 'Редагувати кейс', listTitle: 'Оберіть кейс',
      nameUk: 'Назва (укр)', nameEn: 'Назва (англ)', videoUrl: 'Посилання на відео (YouTube / Vimeo)',
      category: 'Категорія', year: 'Рік', placement: 'Формат / куди пішов ролик',
      placementPh: 'напр.: ТВ реклама, фільм, Reels…',
      descUk: 'Опис проєкту (укр)', descEn: 'Опис проєкту (англ)',
      save: 'Зберегти', saveEdit: 'Зберегти зміни', del: 'Видалити', edit: 'Редагувати',
      back: '‹ Назад', close: 'Закрити',
      saving: 'Зберігаю…', saved: 'Збережено ✓', deleting: 'Видаляю…',
      confirmDel: 'Видалити цей кейс? Дію не можна скасувати.',
      needName: 'Вкажи назву (укр).', needUrl: 'Встав посилання на відео.',
      badUrl: 'Не розпізнано YouTube/Vimeo посилання.', hintUrl: 'Прев’ю візьметься автоматично',
      noCases: 'Ще немає кейсів для редагування. Спочатку додай.',
      ytLocalHint: 'YouTube не програється при відкритті файлу напряму. Запусти сайт через «ЗАПУСТИТИ-САЙТ.bat» (http://localhost).',
      scrollCase: 'Гортати кейс', task: 'Задача', solution: 'Наше рішення', done: 'Що було зроблено',
      videos: 'відео', reelsTitle: 'Ролики кейсу',
      videosLabel: 'Відео кейсу', addVideo: 'Додати відео', cover: 'Обкладинка',
      videosHint: 'Перше відео — головне (обкладинка). Додайте кілька — вони покажуться сіткою роликів у кейсі.',
      viewAll: 'Всі кейси', descHint: 'Виділяй заголовки *зірочками* — вони стануть червоними підзаголовками, решта тексту під ними лишиться звичайним описом. Приклад: *Задача* текст… *Наше рішення* текст…',
      chooseAbout: 'Редагувати «Про нас»', chooseAboutSub: 'Текст на сайті в секції "Про нас"',
      chooseContacts: 'Редагувати контакти', chooseContactsSub: 'Телефон, email, адреса, соцмережі (футер і контакти)',
      aboutTitle: 'Про нас', aboutTextUk: 'Текст укр', aboutTextEn: 'Текст англ',
      contactsTitle: 'Контакти', cPhone: 'Телефон (для посилання tel:)', cPhoneDisplay: 'Телефон (як показувати)',
      cManager: 'Ім’я менеджера', cEmail: 'Email', cAddrUk: 'Адреса (укр)', cAddrEn: 'Адреса (англ)',
      cInstagram: 'Instagram студії (посилання)', cInstagramAgency: 'Instagram агенції (посилання)',
      cInstagramPerson: 'Instagram засновника (посилання)', cYoutube: 'YouTube (посилання)',
      cVimeo: 'Vimeo (посилання)', cFacebook: 'Facebook (посилання)',
      settingsSaved: 'Збережено ✓ Оновиться на сайті за кілька секунд.',
      chooseHero: 'Редагувати Hero', chooseHeroSub: 'Заголовок і опис першого екрана',
      chooseCats: 'Категорії проєктів', chooseCatsSub: 'Додати / змінити / видалити категорії',
      heroScreenTitle: 'Hero (перший екран)',
      heroTitleUk: 'Заголовок (укр)', heroTitleEn: 'Заголовок (англ)',
      heroLeadUk: 'Опис під заголовком (укр)', heroLeadEn: 'Опис під заголовком (англ)',
      heroHint: 'У заголовку кожен новий рядок = перенос рядка на сайті.',
      catsScreenTitle: 'Категорії проєктів',
      catsHint: 'По одній категорії в полі. Порожні ігноруються. Порядок тут = порядок на сайті (у hero й фільтрах).',
      addCat: '+ Додати категорію', catPh: 'Напр.: Commercial', needCats: 'Додайте хоча б одну категорію.',
      chooseServices: 'Секція «Що ми робимо»', chooseServicesSub: 'Заголовок і картки послуг',
      servicesScreenTitle: 'Секція «Що ми робимо»',
      svcEyebrowUk: 'Підпис секції (укр)', svcEyebrowEn: 'Підпис секції (англ)',
      svcTitleUk: 'Заголовок секції (укр)', svcTitleEn: 'Заголовок секції (англ)',
      svcCards: 'Картки послуг', addSvc: '+ Додати послугу', svcRemove: 'Прибрати',
      svcMax: 'Максимум 6 послуг',
      svcTag: 'Тег (напр. Commercial)', svcName: 'Назва (напр. Production)', svcDescLbl: 'Опис', svcFilter: 'Категорія для «Дивитись роботи»',
      svcAll: 'Всі кейси', needSvc: 'Додайте хоча б одну послугу.',
      svcHeadHint: 'Заголовок і підпис секції.',
      svcHint: 'Кожна картка: тег, назва, опис і категорія — саме за нею фільтруються кейси при кліку «Дивитись роботи».',
      viewWork: 'Дивитись роботи',
      choosePhotos: 'Фото сайту', choosePhotosSub: 'Фон Hero і фото в секції «Про нас»',
      photosScreenTitle: 'Фото сайту',
      heroPhotoLabel: 'Фото фону Hero (посилання)',
      aboutPhotoLabel: 'Фото в секції «Про нас» (посилання)',
      photoUrlPh: 'https://…',
      photoHint: 'Вставляй пряме посилання на зображення (закінчується на .jpg/.png/.webp) — напр. з Google Drive («Отримати посилання» → відкрити доступ «Всім, у кого є посилання», потім перетворити на пряме: https://drive.google.com/uc?export=view&id=ID_ФАЙЛУ) або з будь-якого хостингу картинок (Imgur тощо). Порожнє поле = лишається поточне фото.',
      heroPhotoSize: 'Рекомендований розмір: горизонтальне фото, мінімум 1920×1080px (краще 2400×1350px), формат JPG. Фото на весь екран, тому чим ширше — тим чіткіше.',
      aboutPhotoSize: 'Рекомендований розмір: горизонтальне фото (співвідношення сторін приблизно 3:2, напр. 1200×800px і більше). Показується без обрізання — яка фотографія, така й буде на сайті.',
      photoPreview: 'Поточне фото:',
      dropTitle: 'Перетягни фото сюди',
      dropSub: 'або натисни, щоб вибрати файл (JPG / PNG)',
      dropOr: 'або встав посилання вручну:',
      uploading: 'Завантаження фото…',
      uploaded: 'Фото завантажено ✓',
      photoBadType: 'Потрібен файл JPG або PNG.',
      photoReadErr: 'Не вдалося прочитати файл.',
      photoUploadErr: 'Не вдалося завантажити фото. Перевір інтернет і що скрипт перерозгорнуто.',
      showreelLabel: 'Відео шоуріл (посилання)',
      showreelHint: 'Посилання на Vimeo/YouTube — відкривається по кнопці «Дивитись шоуріл» у hero.',
      gateMsg: 'Перше завантаження сайту…',
      gateSub: 'Далі сайт відкриватиметься миттєво.',
      passTitle: 'Пароль адмінки', passLabel: 'Пароль', passSubmit: 'Увійти',
      passWrong: 'Невірний пароль.', passNeed: 'Введи пароль.',
      choosePassword: 'Змінити пароль', choosePasswordSub: 'Пароль для входу в адмінку',
      passScreenTitle: 'Змінити пароль',
      passCurrent: 'Поточний пароль', passNew: 'Новий пароль', passNewRepeat: 'Повтори новий пароль',
      passMismatch: 'Нові паролі не збігаються.', passSaved: 'Пароль змінено ✓'
    },
    en: {
      heading: 'Our work', eyebrow: 'Our cases',
      sub: 'Cases are stored in a Google Sheet — manage them without a developer',
      manage: 'Manage cases', all: 'All', watch: 'Watch', openCase: 'Watch case',
      empty: 'No cases yet.', loading: 'Loading…',
      loadErr: 'Connection error. Check the script deployment.',
      chooseTitle: 'What to do?', chooseAdd: 'Add case', chooseAddSub: 'New case in portfolio',
      chooseEdit: 'Edit cases', chooseEditSub: 'Change or delete existing',
      addTitle: 'New case', editTitle: 'Edit case', listTitle: 'Choose a case',
      nameUk: 'Title (UA)', nameEn: 'Title (EN)', videoUrl: 'Video link (YouTube / Vimeo)',
      category: 'Category', year: 'Year', placement: 'Format / where it aired',
      placementPh: 'e.g.: TV commercial, film, Reels…',
      descUk: 'Project description (UA)', descEn: 'Project description (EN)',
      save: 'Save', saveEdit: 'Save changes', del: 'Delete', edit: 'Edit',
      back: '‹ Back', close: 'Close',
      saving: 'Saving…', saved: 'Saved ✓', deleting: 'Deleting…',
      confirmDel: 'Delete this case? This cannot be undone.',
      needName: 'Enter a title (UA).', needUrl: 'Paste a video link.',
      badUrl: 'Could not parse a YouTube/Vimeo link.', hintUrl: 'Thumbnail is fetched automatically',
      noCases: 'No cases to edit yet. Add one first.',
      ytLocalHint: 'YouTube will not play when opening the file directly. Launch via “ЗАПУСТИТИ-САЙТ.bat” (http://localhost).',
      scrollCase: 'Scroll to case', task: 'The task', solution: 'Our solution', done: 'What we did',
      videos: 'videos', reelsTitle: 'Case reels',
      videosLabel: 'Case videos', addVideo: 'Add video', cover: 'Cover',
      videosHint: 'The first video is the main one (cover). Add several — they appear as a reels grid in the case.',
      viewAll: 'All work', descHint: 'Wrap headings in *asterisks* — they become red subheadings, the rest of the text under them stays a normal description. Example: *The task* text… *Our solution* text…',
      chooseAbout: 'Edit "About us"', chooseAboutSub: 'The About-us text shown on the site',
      chooseContacts: 'Edit contacts', chooseContactsSub: 'Phone, email, address, socials (footer & contact section)',
      aboutTitle: 'About us', aboutTextUk: 'Text (UA)', aboutTextEn: 'Text (EN)',
      contactsTitle: 'Contacts', cPhone: 'Phone (for tel: link)', cPhoneDisplay: 'Phone (displayed)',
      cManager: 'Manager name', cEmail: 'Email', cAddrUk: 'Address (UA)', cAddrEn: 'Address (EN)',
      cInstagram: 'Studio Instagram (link)', cInstagramAgency: 'Agency Instagram (link)',
      cInstagramPerson: 'Founder Instagram (link)', cYoutube: 'YouTube (link)',
      cVimeo: 'Vimeo (link)', cFacebook: 'Facebook (link)',
      settingsSaved: 'Saved ✓ The site will update in a few seconds.',
      chooseHero: 'Edit Hero', chooseHeroSub: 'Title and description of the first screen',
      chooseCats: 'Project categories', chooseCatsSub: 'Add / edit / delete categories',
      heroScreenTitle: 'Hero (first screen)',
      heroTitleUk: 'Title (UA)', heroTitleEn: 'Title (EN)',
      heroLeadUk: 'Description under title (UA)', heroLeadEn: 'Description under title (EN)',
      heroHint: 'In the title, each new line = a line break on the site.',
      catsScreenTitle: 'Project categories',
      catsHint: 'One category per field. Empty ones are ignored. Order here = order on the site (hero & filters).',
      addCat: '+ Add category', catPh: 'E.g.: Commercial', needCats: 'Add at least one category.',
      chooseServices: '"What we do" section', chooseServicesSub: 'Heading and service cards',
      servicesScreenTitle: '"What we do" section',
      svcEyebrowUk: 'Section eyebrow (UA)', svcEyebrowEn: 'Section eyebrow (EN)',
      svcTitleUk: 'Section title (UA)', svcTitleEn: 'Section title (EN)',
      svcCards: 'Service cards', addSvc: '+ Add service', svcRemove: 'Remove',
      svcMax: 'Maximum 6 services',
      svcTag: 'Tag (e.g. Commercial)', svcName: 'Name (e.g. Production)', svcDescLbl: 'Description', svcFilter: 'Category for "View work"',
      svcAll: 'All work', needSvc: 'Add at least one service.',
      svcHeadHint: 'Section title and eyebrow.',
      svcHint: 'Each card: tag, name, description and a category — clicking "View work" filters cases by it.',
      viewWork: 'View work',
      choosePhotos: 'Site photos', choosePhotosSub: 'Hero background and the "About us" photo',
      photosScreenTitle: 'Site photos',
      heroPhotoLabel: 'Hero background photo (link)',
      aboutPhotoLabel: '"About us" photo (link)',
      photoUrlPh: 'https://…',
      photoHint: 'Paste a direct image link (ending in .jpg/.png/.webp) — e.g. from Google Drive ("Get link" → set access to "Anyone with the link", then convert to a direct link: https://drive.google.com/uc?export=view&id=FILE_ID) or any image host (Imgur etc). Leave empty to keep the current photo.',
      heroPhotoSize: 'Recommended size: landscape photo, at least 1920×1080px (2400×1350px is better), JPG. It fills the whole screen, so wider = sharper.',
      aboutPhotoSize: 'Recommended size: landscape photo (roughly 3:2 ratio, e.g. 1200×800px or larger). Shown uncropped — whatever the photo looks like is exactly how it appears on the site.',
      photoPreview: 'Current photo:',
      dropTitle: 'Drag a photo here',
      dropSub: 'or click to choose a file (JPG / PNG)',
      dropOr: 'or paste a link manually:',
      uploading: 'Uploading photo…',
      uploaded: 'Photo uploaded ✓',
      photoBadType: 'JPG or PNG file required.',
      photoReadErr: 'Could not read the file.',
      photoUploadErr: 'Could not upload the photo. Check your internet and that the script is re-deployed.',
      showreelLabel: 'Showreel video (link)',
      showreelHint: 'Vimeo/YouTube link — opens from the "Watch Showreel" button in the hero.',
      gateMsg: 'First-time loading…',
      gateSub: 'The site will open instantly after this.',
      passTitle: 'Admin password', passLabel: 'Password', passSubmit: 'Enter',
      passWrong: 'Wrong password.', passNeed: 'Enter a password.',
      choosePassword: 'Change password', choosePasswordSub: 'Password for the admin panel',
      passScreenTitle: 'Change password',
      passCurrent: 'Current password', passNew: 'New password', passNewRepeat: 'Repeat new password',
      passMismatch: 'New passwords do not match.', passSaved: 'Password changed ✓'
    }
  }[LANG];

  /* ---------- Демо-кейси (fallback), поки бекенд порожній/недоступний ----------
     Дають «готовий» вигляд сітки одразу. Як тільки в Таблиці зʼявляться реальні
     кейси — вони повністю замінюють цей набір. Керування ними — через адмінку. */
  var SEED = [
    { id: 'seed-westa', name_uk: 'WESTA', name_en: 'WESTA', category: 'Commercial', year: '2024',
      placement: 'Промо', provider: 'vimeo', video_id: '1045734109',
      video_url: 'https://vimeo.com/1045734109', thumb: 'include/img/works4/westa.png',
      desc_uk: 'Задача: показати продукт бренду свіжо й динамічно.\nНаше рішення: яскравий промо-ролик із чіткою ідеєю.\nЩо було зроблено: концепція, сценарій, зйомка, монтаж, color grading.',
      desc_en: 'The task: present the brand product in a fresh, dynamic way.\nOur solution: a bright promo film with a clear idea.\nWhat we did: concept, script, shooting, editing, color grading.' },
    { id: 'seed-golden', name_uk: 'Готель «Золотий пляж»', name_en: 'Golden Beach Hotel', category: 'Commercial', year: '2024',
      placement: 'Реклама', provider: 'vimeo', video_id: '1045745423',
      video_url: 'https://vimeo.com/1045745423', thumb: 'include/img/works4/golden_beach.png',
      desc_uk: 'Іміджева реклама курортного готелю: атмосфера відпочинку та деталі сервісу.',
      desc_en: 'Image commercial for a resort hotel: the atmosphere of rest and the details of service.' },
    { id: 'seed-lol', name_uk: 'L.O.L + KIDDISVIT', name_en: 'L.O.L + KIDDISVIT', category: 'Social Content', year: '2022',
      placement: 'Серія з 4 вертикальних роликів', provider: 'vimeo', video_id: '656145490',
      video_url: 'https://vimeo.com/656145490', thumb: 'include/img/works/lol_kiddisvit.jpg',
      desc_uk: 'Задача: розкрутити дитячий бренд у соцмережах.\nНаше рішення: серія коротких вертикальних роликів.\nЩо було зроблено: креативна концепція, сценарії, продюсування, зйомка, монтаж, color grading.',
      desc_en: 'The task: grow a children’s brand on social media.\nOur solution: a series of short vertical videos.\nWhat we did: creative concept, scripts, producing, shooting, editing, color grading.',
      reels: 'https://vimeo.com/656145490\nhttps://vimeo.com/656171487\nhttps://vimeo.com/595788541\nhttps://vimeo.com/595786790' },
    { id: 'seed-tsina', name_uk: 'Ціна питання', name_en: 'The Price of the Question', category: 'Podcasts', year: '2024',
      placement: 'Подкаст', provider: 'vimeo', video_id: '693969376',
      video_url: 'https://vimeo.com/693969376', thumb: 'include/img/works/back1.jpg',
      desc_uk: 'Студійний подкаст повного циклу: багатокамерна зйомка, світло, звук, монтаж.',
      desc_en: 'A full-cycle studio podcast: multi-camera shooting, lighting, sound and editing.' },
    { id: 'seed-yaktak', name_uk: 'YAKTAK', name_en: 'YAKTAK', category: 'YouTube', year: '2023',
      placement: 'YouTube', provider: 'vimeo', video_id: '784082737',
      video_url: 'https://vimeo.com/784082737', thumb: 'include/img/works/sw.jpg',
      desc_uk: 'Контент для YouTube-каналу: зйомка, монтаж і оформлення випусків.',
      desc_en: 'Content for a YouTube channel: shooting, editing and episode design.' },
    { id: 'seed-snow', name_uk: 'На новий рік обіцяють сніг', name_en: 'Snow is promised for New Year', category: 'Documentary', year: '2022',
      placement: 'Трейлер', provider: 'vimeo', video_id: '663735486',
      video_url: 'https://vimeo.com/663735486', thumb: 'include/img/works/new_year_2021.jpg',
      desc_uk: 'Трейлер повнометражної новорічної історії від команди Contrabas.',
      desc_en: 'A trailer for a full-length New Year story by the Contrabas team.' },
    { id: 'seed-vitals', name_uk: 'VITALS', name_en: 'VITALS', category: 'Commercial', year: '2021',
      placement: 'ТВ реклама', provider: 'vimeo', video_id: '538309611',
      video_url: 'https://vimeo.com/538309611', thumb: 'include/img/works/vitals.jpg',
      desc_uk: 'ТВ-реклама для бренду VITALS.',
      desc_en: 'A TV commercial for the VITALS brand.' },
    { id: 'seed-veladis', name_uk: 'VELADIS', name_en: 'VELADIS', category: 'Social Content', year: '2021',
      placement: 'Digital', provider: 'vimeo', video_id: '534356018',
      video_url: 'https://vimeo.com/534356018', thumb: 'include/img/works/veladis_kozak.jpg',
      desc_uk: 'Digital-кампанія бренду VELADIS для соцмереж.',
      desc_en: 'A digital campaign for the VELADIS brand across social media.' }
  ];

  /* ---------------- JSONP ---------------- */
  var seq = 0;
  function jsonp(params) {
    return new Promise(function (resolve, reject) {
      var name = '__cc_' + (++seq) + '_' + Date.now();
      var s = document.createElement('script');
      var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, 12000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[name]; } catch (e) { window[name] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[name] = function (data) { cleanup(); resolve(data); };
      s.onerror = function () { cleanup(); reject(new Error('network')); };
      var q = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      s.src = ENDPOINT + '?callback=' + name + '&' + q;
      document.head.appendChild(s);
    });
  }

  /* ------------- Відео + прев’ю ------------- */
  function parseVideo(url) {
    url = (url || '').trim();
    var m;
    m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (m) return { provider: 'youtube', id: m[1], thumb: 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg' };
    // Приватні Vimeo-посилання мають вигляд vimeo.com/12345/abcdef0123 —
    // другий сегмент (hash) ОБОВ'ЯЗКОВИЙ для показу відео (без нього плеєр
    // видасть "This video is private"). Зберігаємо його разом з id як
    // "12345/abcdef0123" — embedUrl() нижче розбирає це назад.
    m = url.match(/vimeo\.com\/(?:video\/|channels\/[^\/]+\/|groups\/[^\/]+\/videos\/)?(\d+)(?:\/([a-zA-Z0-9]+))?/);
    if (m) return { provider: 'vimeo', id: m[1] + (m[2] ? '/' + m[2] : ''), thumb: '' };
    return null;
  }
  function fetchVimeoThumb(id, cb) {
    var name = '__ccv_' + id + '_' + Date.now();
    var s = document.createElement('script');
    var done = false;
    function finish(th) {
      if (done) return; done = true;
      clearTimeout(timer);
      try { delete window[name]; } catch (e) { window[name] = undefined; }
      if (s.parentNode) s.parentNode.removeChild(s);
      cb(th || '');
    }
    var timer = setTimeout(function () { finish(''); }, 8000);
    window[name] = function (data) { finish(data && data.thumbnail_url ? data.thumbnail_url.replace(/_\d+x\d+/, '_640') : ''); };
    s.onerror = function () { finish(''); };
    s.src = 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/' + id) + '&callback=' + name + '&width=640';
    document.head.appendChild(s);
  }
  function embedUrl(i) {
    var v = resolveVideo(i);
    if (!v) return '';
    // autoplay браузери дозволяють лише БЕЗ звуку → стартуємо в mute, а користувач
    // сам вмикає звук кнопкою в плеєрі. playsinline+controls тримають відео на сайті
    // (без mute автозапуск блокується, і YouTube показує постер-посилання, тап по
    // якому на телефоні перекидає на youtube.com — саме це й ловив користувач).
    if (v.provider === 'youtube') return 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&mute=1&rel=0&playsinline=1&controls=1&modestbranding=1';
    if (v.provider === 'vimeo') {
      // v.id може бути "12345" або "12345/hash" (приватне відео) — hash іде
      // окремим параметром ?h=, а не частиною шляху /video/.
      var vParts = String(v.id).split('/');
      var vHash = vParts.length > 1 ? '&h=' + vParts[1] : '';
      return 'https://player.vimeo.com/video/' + vParts[0] + '?autoplay=1&muted=1&playsinline=1' + vHash;
    }
    return '';
  }
  // Надійне визначення відео кейсу: спершу довіряємо збереженим provider/video_id
  // (нормалізуючи регістр і пробіли), а якщо вони порожні/биті/не збігаються з
  // жодним відомим провайдером — ПЕРЕПАРСЮЄМО напряму з video_url (або першого
  // ролика reels). Це лікує ситуації, коли в Google Таблиці провайдер записаний
  // з великої літери, з пробілом, або поле video_id взагалі порожнє — раніше в
  // таких випадках плеєр мовчки падав у посилання «дивитись на YouTube».
  function resolveVideo(item) {
    if (!item) return null;
    var provider = String(item.provider || '').trim().toLowerCase();
    var id = String(item.video_id == null ? '' : item.video_id).trim();
    if ((provider === 'youtube' || provider === 'vimeo') && id) {
      return { provider: provider, id: id, thumb: provider === 'youtube' ? 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg' : '' };
    }
    var firstUrl = item.video_url || (item.reels ? String(item.reels).split(/[\r\n,]+/)[0] : '');
    var v = parseVideo(firstUrl);
    return v || null;
  }
  function isFileProto() { return location.protocol === 'file:'; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function thumbOf(i) {
    if (i.thumb) return i.thumb;
    var v = resolveVideo(i);
    return (v && v.provider === 'youtube') ? 'https://img.youtube.com/vi/' + v.id + '/hqdefault.jpg' : '';
  }
  function watchUrlOf(i) {
    if (i.video_url) return i.video_url;
    var v = resolveVideo(i);
    if (!v) return '#';
    return v.provider === 'youtube' ? 'https://youtu.be/' + v.id : 'https://vimeo.com/' + v.id;
  }
  function pick(i, uk, en) { return (LANG === 'en' && i[en]) ? i[en] : i[uk]; }

  /* ---------------- Стан ---------------- */
  var ALL = [];               // РЕАЛЬНІ кейси з таблиці (керує адмінка: список/редагування/видалення)
  var activeFilter = 'all';
  var editingId = null;
  var modalSession = 0;       // лічильник відкриттів адмін-модалки (захист від відкладеного автозакриття)
  // Текст "Про нас" і контакти — теж з Google Таблиці (листи about/contacts).
  // Поки не завантажилось (або бекенд недоступний) — лишається статичний текст
  // із самого HTML (fallback), сторінка виглядає готовою одразу.
  var SITE_ABOUT = null;      // { uk, en }
  var SITE_CONTACTS = null;   // { phone, phone_display, manager, email, address_uk, address_en, telegram, instagram, youtube, vimeo, facebook }
  var SITE_HERO = null;       // { title_uk, title_en, lead_uk, lead_en, services_eyebrow_*, services_title_* }
  var SITE_SERVICES = null;   // [{ tag_uk, tag_en, name_uk, name_en, desc_uk, desc_en, filter }, …] — картки «Що ми робимо»
  // Стартуємо оптимістично з демо-набором, щоб портфоліо було готовим МИТТЄВО.
  // Коли бекенд відповість реальними кейсами — вони замінять демо; якщо він
  // доступний і порожній — сітка стане порожньою; якщо недоступний — лишиться демо.
  var backendFailed = true;

  // Набір для ПУБЛІЧНОЇ сітки — ЛИШЕ реальні кейси з Google Таблиці.
  // Демо-набір SEED більше НЕ показується на сайті (на прохання) — навіть якщо
  // бекенд недоступний, сітка просто лишається порожньою, а не підміняється
  // старими/тестовими кейсами. Адмінка (список/редагування/видалення) так само
  // працює лише з реальним ALL.
  function shown() { return ALL; }
  function findShown(id) {
    var pool = shown();
    for (var i = 0; i < pool.length; i++) if (String(pool[i].id) === String(id)) return pool[i];
    return null;
  }

  /* ---------------- Каркас ---------------- */
  // data-limit на #cc-root вмикає «домашній» режим: не більше N карток в один ряд
  // (далі — горизонтальний скрол, без переносу на 2-й ряд) + лінк «Всі кейси»,
  // що веде на окрему сторінку з повним портфоліо (works.html / works-en.html).
  // Без data-limit (сторінка works.html) — звичайна сітка з переносом рядків.
  var LIMIT = null;
  function viewAllHref() { return LANG === 'en' ? 'works-eng.html' : 'works.html'; }
  function build() {
    var host = document.getElementById('cc-root');
    if (!host) return;
    var limAttr = host.getAttribute('data-limit');
    LIMIT = (limAttr && limAttr !== 'all') ? parseInt(limAttr, 10) || null : null;
    // На сторінці повного портфоліо (works) можна прийти з фільтром у URL
    // (?cat=Commercial) — напр. клік «Дивитись роботи» на головній.
    if (!LIMIT) {
      try {
        var qcat = new URLSearchParams(location.search).get('cat');
        if (qcat) activeFilter = qcat;
      } catch (e) {}
    }
    host.innerHTML =
      '<div class="cc-wrap' + (LIMIT ? ' cc-wrap--scroll' : '') + '">' +
        '<div class="cc-head">' +
          // Верхній рядок: заголовок ліворуч (тільки на головній — на «Всі кейси»
          // вже є H1), кнопка керування праворуч.
          '<div class="cc-head__top">' +
            (LIMIT ? (
              '<div class="cc-head__l">' +
                '<span class="cx-eyebrow" data-cc-admin-trigger>' + esc(T.eyebrow) + '</span>' +
                '<h2>' + esc(T.heading) + '</h2>' +
              '</div>'
            ) : '<div class="cc-head__l"></div>') +
          '</div>' +
          // Нижній рядок: категорії (фільтри) ліворуч, кнопка «Всі кейси» праворуч.
          '<div class="cc-head__bar">' +
            '<div class="cc-filters" id="cc-filters"></div>' +
            (LIMIT ? '<a class="cx-viewall" href="' + esc(viewAllHref()) + '">' + esc(T.viewAll) + '</a>' : '') +
          '</div>' +
        '</div>' +
        '<div class="cc-cases" id="cc-cases"><div class="cc-empty">' + T.loading + '</div></div>' +
        (LIMIT ? '<div class="cc-scrollbar" id="cc-scrollbar"><span class="cc-scrollbar__thumb" id="cc-scrollbar-thumb"></span></div>' : '') +
      '</div>' +
      modalHtml() + videoModalHtml();

    attachAdminTriggers();
    wireModal(); wireVideoModal();
    renderFilters(); renderCases();
    renderHeroList();

    // Якщо кешу ще немає (перший візит на цьому пристрої) — показуємо
    // повноекранний loading-гейт, поки не прийдуть реальні дані з таблиці.
    // З кешем — жодного гейта, все миттєво з нього, свіжі дані тягнуться тихо.
    // ОДИН запит (action=site тепер містить і кейси) замість двох паралельних —
    // менше затримки на перше завантаження.
    var hasCache = !!(cacheGet('site') && cacheGet('cases'));
    if (!hasCache) showLoadingGate();
    loadSite().then(function () {
      // Захист на випадок, якщо бекенд ще не перерозгорнутий (стара версія
      // action=site без кейсів у відповіді) — довантажуємо кейси окремо, щоб
      // сітка не лишилася порожньою. На оновленому бекенді casesBooted вже
      // true (кейси прийшли разом із site), тому цей виклик просто не робиться.
      var extra = casesBooted ? null : loadCases();
      return extra;
    }).then(function () {
      if (!hasCache) hideLoadingGate();
    });

    if (LIMIT) wireScrollbar();
  }

  /* ---------------- Стильний тонкий скрол-індикатор (замість системного) ---------------- */
  function wireScrollbar() {
    var box = document.getElementById('cc-cases');
    var track = document.getElementById('cc-scrollbar');
    var thumb = document.getElementById('cc-scrollbar-thumb');
    if (!box || !track || !thumb) return;

    function update() {
      var max = box.scrollWidth - box.clientWidth;
      if (max <= 4) { track.style.display = 'none'; return; }
      track.style.display = '';
      var ratio = box.clientWidth / box.scrollWidth;
      var pos = box.scrollLeft / max;
      thumb.style.width = (ratio * 100) + '%';
      thumb.style.transform = 'translateX(' + (pos * (100 / ratio - 100)) + '%)';
    }

    box.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // Перерахунок після завантаження реальних кейсів/зображень (може змінитись ширина).
    var ro = (window.ResizeObserver ? new ResizeObserver(update) : null);
    if (ro) ro.observe(box);
    setTimeout(update, 60);

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // Колесо миші НЕ чіпаємо — воно завжди гортає сторінку вертикально, як
    // на будь-якому звичайному сайті. Прокрутка ряду — тільки свайпом/драгом.

    // ---------- Драг самого ряду карток (Pointer Events — надійно й плавно) ----------
    // Pointer Events (замість mousedown/mousemove на window) дають гарантовану,
    // безперервну доставку подій одному елементу через setPointerCapture —
    // це прибирає «сіпання»/пропущені кліки, які були з голими mouse-подіями.
    // ВАЖЛИВО: setPointerCapture() перенаправляє НАСТУПНІ події (включно з
    // click) на елемент захвату — тож якщо захопити вказівник одразу на
    // pointerdown, звичайний клік по картці/посиланню всередині перестає
    // доходити до свого справжнього елемента (завжди «влучає» в сам ряд).
    // Тому захоплюємо лише тоді, коли рух дійсно перевищив поріг («це драг,
    // а не клік») — звичайний клік тоді ніколи не чіпається і працює як завжди.
    var rowPointerId = null, rowStartX = 0, rowStartLeft = 0, rowCaptured = false;
    var DRAG_THRESHOLD = 6;

    box.addEventListener('pointerdown', function (e) {
      // На дотику й пері лишаємо нативний плавний скрол браузера (він і так
      // працює через overflow-x: auto) — власний драг вмикаємо лише для миші,
      // бо тільки в неї немає вбудованого способу «потягнути» рядок.
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (e.button !== undefined && e.button !== 0) return; // тільки ліва кнопка миші
      rowPointerId = e.pointerId; rowStartX = e.clientX; rowStartLeft = box.scrollLeft; rowCaptured = false;
    });
    box.addEventListener('pointermove', function (e) {
      if (e.pointerId !== rowPointerId) return;
      var dx = e.clientX - rowStartX;
      if (!rowCaptured) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return; // ще недостатньо руху — це може бути просто клік
        rowCaptured = true;
        box.setPointerCapture(rowPointerId);
        box.classList.add('is-dragging');
      }
      box.scrollLeft = rowStartLeft - dx;
    });
    function endRowDrag(e) {
      if (e.pointerId !== rowPointerId) return;
      rowPointerId = null; rowCaptured = false;
      box.classList.remove('is-dragging');
    }
    box.addEventListener('pointerup', endRowDrag);
    box.addEventListener('pointercancel', endRowDrag);

    // ---------- Перетягування самої смужки-індикатора ----------
    var barPointerId = null, barStartX = 0, barStartLeft = 0;
    thumb.addEventListener('pointerdown', function (e) {
      barPointerId = e.pointerId; barStartX = e.clientX; barStartLeft = box.scrollLeft;
      thumb.setPointerCapture(barPointerId);
      track.classList.add('is-dragging');
      e.stopPropagation();
    });
    thumb.addEventListener('pointermove', function (e) {
      if (e.pointerId !== barPointerId) return;
      var max = box.scrollWidth - box.clientWidth;
      var trackSpace = track.clientWidth - thumb.offsetWidth;
      if (trackSpace <= 0) return;
      var dx = e.clientX - barStartX;
      box.scrollLeft = clamp(barStartLeft + dx * (max / trackSpace), 0, max);
    });
    function endBarDrag(e) {
      if (e.pointerId !== barPointerId) return;
      barPointerId = null; track.classList.remove('is-dragging');
    }
    thumb.addEventListener('pointerup', endBarDrag);
    thumb.addEventListener('pointercancel', endBarDrag);

    // Клік по доріжці поза повзунком — стрибок скролу до цього місця.
    track.addEventListener('pointerdown', function (e) {
      if (e.target === thumb) return;
      var rect = track.getBoundingClientRect();
      var ratioClick = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      var max = box.scrollWidth - box.clientWidth;
      box.scrollLeft = ratioClick * max;
    });
  }

  /* ============ Відео / кейс-модалка (перегляд) ============ */
  function videoModalHtml() {
    return (
    '<div class="cc-vmodal" id="cc-vmodal" aria-hidden="true">' +
      '<div class="cc-vmodal__overlay" data-vclose="1"></div>' +
      '<div class="cc-vmodal__box" role="dialog" aria-modal="true">' +
        '<button type="button" class="cc-vmodal__x" data-vclose="1" aria-label="' + esc(T.close) + '">&times;</button>' +
        '<div class="cc-vmodal__scroll">' +
          '<div class="cc-vmodal__left">' +
            '<div class="cc-vmodal__player" id="cc-vplayer"></div>' +
            '<div class="cc-vmodal__reels" id="cc-vreels"></div>' +
          '</div>' +
          '<div class="cc-vmodal__sideWrap">' +
            '<div class="cc-vmodal__side">' +
              '<div class="cc-vmodal__sideTop">' +
                '<span class="cc-vmodal__cat" id="cc-vcat"></span>' +
                '<h3 class="cc-vmodal__title" id="cc-vtitle"></h3>' +
                '<div class="cc-vmodal__meta" id="cc-vmeta"></div>' +
                '<div class="cc-vmodal__desc" id="cc-vdesc"></div>' +
              '</div>' +
              '<a class="cc-vmodal__ext" id="cc-vext" href="#" target="_blank" rel="noopener"></a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>');
  }
  function wireVideoModal() {
    var vm = document.getElementById('cc-vmodal');
    vm.addEventListener('click', function (e) { if (e.target.getAttribute('data-vclose')) closeVideo(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && vm.classList.contains('is-open')) closeVideo();
    });
  }
  function openVideo(item) {
    var title = pick(item, 'name_uk', 'name_en');
    var desc = pick(item, 'desc_uk', 'desc_en');
    var rv = resolveVideo(item);
    var url = embedUrl(item);
    var player = document.getElementById('cc-vplayer');
    if (url && !(rv && rv.provider === 'youtube' && isFileProto())) {
      player.innerHTML = '<iframe src="' + esc(url) + '" allow="autoplay; fullscreen; encrypted-media" ' +
        'referrerpolicy="strict-origin-when-cross-origin" frameborder="0"></iframe>';
    } else {
      var th = thumbOf(item);
      player.innerHTML =
        '<a class="cc-vmodal__fallback" href="' + esc(watchUrlOf(item)) + '" target="_blank" rel="noopener">' +
          (th ? '<img src="' + esc(th) + '" alt="">' : '') +
          '<span class="cc-vmodal__fallbackBtn">▶ ' + esc(T.watch) + '</span>' +
          (rv && rv.provider === 'youtube' && isFileProto() ? '<span class="cc-vmodal__hint">' + esc(T.ytLocalHint) + '</span>' : '') +
        '</a>';
    }
    document.getElementById('cc-vcat').textContent = item.category || '';
    document.getElementById('cc-vtitle').textContent = title || '';
    var meta = [];
    if (item.year) meta.push(esc(item.year));
    if (item.placement) meta.push(esc(item.placement));
    document.getElementById('cc-vmeta').innerHTML = meta.join(' · ');
    // Опис кейсу: якщо містить блоки «Задача/Рішення/Що зроблено» — структуруємо;
    // інакше показуємо як звичайний текст. У будь-якому разі #cc-vdesc містить повний опис.
    document.getElementById('cc-vdesc').innerHTML = formatCaseDesc(desc || '');
    var ext = document.getElementById('cc-vext');
    ext.href = watchUrlOf(item);
    ext.textContent = (rv && rv.provider === 'vimeo' ? 'Vimeo' : (rv && rv.provider === 'youtube' ? 'YouTube' : T.watch)) + ' ↗';
    // Відкриваємо модалку ПЕРШ НІЖ будувати сітку роликів — щоб будь-яка проблема
    // з роликами НЕ завадила відкрити кейс (модалка з кількома відео теж відкриється).
    var vm = document.getElementById('cc-vmodal');
    vm.classList.add('is-open'); vm.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('no-scroll');
    // Сітка роликів кейсу (напр. 10 вертикальних Reels). Кожен — окреме відео у попапі.
    try { renderReels(item, player); }
    catch (e) {
      var rb = document.getElementById('cc-vreels');
      if (rb) { rb.innerHTML = ''; rb.classList.remove('cc-on'); }
      if (window.console && console.warn) console.warn('renderReels:', e);
    }
  }
  // Перетворює опис у структуровані блоки з червоними підзаголовками.
  // Пріоритет 1 — вільний синтаксис *Заголовок* (будь-який текст в одинарних
  // зірочках на своєму рядку): усе, що йде далі до наступного *Заголовка* — опис.
  // Пріоритет 2 (для старих кейсів без зірочок) — фіксовані ключові слова
  // «Задача / Наше рішення / Що було зроблено» на початку рядка.
  // Якщо нічого з цього не знайдено — просто текст.
  function formatCaseDesc(text) {
    if (!text) return '';
    // Опис може прийти з бекенду не рядком (число/масив/об'єкт) — приводимо до рядка,
    // інакше text.split падає і весь openVideo обривається (кейс не відкривається).
    if (typeof text !== 'string') {
      if (Array.isArray(text)) text = text.join('\n');
      else if (typeof text === 'object') text = '';
      else text = String(text);
    }
    if (!text) return '';
    var lines = text.split(/\r?\n/);

    // --- Пріоритет 1: *Заголовок* на власному рядку (або на початку рядка) ---
    var starRe = /^\s*\*([^*]+)\*\s*$/;              // весь рядок — «*Заголовок*»
    var starInlineRe = /^\s*\*([^*]+)\*\s*(.*)$/;     // «*Заголовок* далі текст на тому ж рядку»
    var hasStars = lines.some(function (l) { return starRe.test(l) || starInlineRe.test(l); });
    if (hasStars) {
      var html1 = '', buf1 = '', curLabel1 = '', any1 = false;
      function flush1() {
        if (curLabel1) html1 += '<div class="cc-case__block"><h4>' + esc(curLabel1) + '</h4><p>' + esc(buf1.trim()) + '</p></div>';
        else if (buf1.trim()) html1 += '<p>' + esc(buf1.trim()) + '</p>';
        buf1 = '';
      }
      lines.forEach(function (l) {
        var mFull = l.match(starRe);
        var mInline = !mFull ? l.match(starInlineRe) : null;
        if (mFull) {
          flush1(); curLabel1 = mFull[1].trim(); any1 = true;
        } else if (mInline) {
          flush1(); curLabel1 = mInline[1].trim(); buf1 = mInline[2] || ''; any1 = true;
        } else {
          buf1 += (buf1 ? '\n' : '') + l;
        }
      });
      flush1();
      if (any1) return html1;
    }

    // --- Пріоритет 2: старі кейси з фіксованими ключовими словами (без зірочок) ---
    var labels = [
      { re: /^\s*(задача|the task|task)\s*[:：]?/i, key: 'task' },
      { re: /^\s*(наше рішення|наше решение|our solution|solution)\s*[:：]?/i, key: 'solution' },
      { re: /^\s*(що було зроблено|що зроблено|what we did|what was done)\s*[:：]?/i, key: 'done' }
    ];
    var hasStruct = lines.some(function (l) { return labels.some(function (x) { return x.re.test(l); }); });
    if (!hasStruct) return esc(text);
    var html = '', buf = '', curLabel = '';
    function flush() {
      if (curLabel) html += '<div class="cc-case__block"><h4>' + esc(curLabel) + '</h4><p>' + esc(buf.trim()) + '</p></div>';
      else if (buf.trim()) html += '<p>' + esc(buf.trim()) + '</p>';
      buf = '';
    }
    lines.forEach(function (l) {
      var matched = null;
      for (var i = 0; i < labels.length; i++) {
        if (labels[i].re.test(l)) { matched = labels[i]; break; }
      }
      if (matched) {
        flush();
        curLabel = T[matched.key];
        buf = l.replace(matched.re, '').trim();
      } else {
        buf += (buf ? '\n' : '') + l;
      }
    });
    flush();
    return html;
  }

  // Парсинг списку роликів кейсу: рядки/коми з посиланнями YouTube/Vimeo.
  function parseReels(item) {
    var raw = item.reels || item.reel_urls || '';
    if (!raw) return [];
    return String(raw).split(/[\n,]+/).map(function (s) { return s.trim(); })
      .filter(Boolean).map(function (u) { return parseVideo(u); }).filter(Boolean);
  }
  // Рендер сітки роликів (2 колонки, як у ТЗ). Клік по ролику відкриває його у плеєрі.
  function renderReels(item, player) {
    var box = document.getElementById('cc-vreels');
    if (!box) return;
    var reels = parseReels(item);
    // Сітка роликів має сенс лише для кейсів із кількома відео (2+).
    if (reels.length < 2) { box.innerHTML = ''; box.classList.remove('cc-on'); return; }
    box.classList.add('cc-on');
    box.innerHTML = '<h4 class="cc-vmodal__reelsTitle">' + esc(T.reelsTitle) + '</h4><div class="cc-reels-grid">' +
      reels.map(function (r, idx) {
        var th = r.provider === 'youtube' ? r.thumb : '';
        return '<button type="button" class="cc-reel" data-reel="' + idx + '">' +
          '<span class="cc-reel__media">' +
            (th ? '<img loading="lazy" src="' + esc(th) + '" alt="Reel ' + (idx + 1) + '">'
                : '<img loading="lazy" alt="Reel ' + (idx + 1) + '" data-vimeo="' + esc(r.id) + '">') +
            '<span class="cc-reel__play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>' +
          '</span>' +
          '<span class="cc-reel__n">Reel ' + (idx + 1) + '</span>' +
        '</button>';
      }).join('') + '</div>';
    Array.prototype.forEach.call(box.querySelectorAll('.cc-reel'), function (b) {
      b.addEventListener('click', function () {
        var r = reels[parseInt(b.getAttribute('data-reel'), 10)];
        if (!r) return;
        var pl = document.getElementById('cc-vplayer');
        var eu = embedUrl({ provider: r.provider, video_id: r.id });
        if (eu && !(r.provider === 'youtube' && isFileProto())) {
          pl.innerHTML = '<iframe src="' + esc(eu) + '" allow="autoplay; fullscreen; encrypted-media" ' +
            'referrerpolicy="strict-origin-when-cross-origin" frameborder="0"></iframe>';
        } else {
          pl.innerHTML = '<a class="cc-vmodal__fallback" href="' +
            esc(r.provider === 'youtube' ? 'https://youtu.be/' + r.id : 'https://vimeo.com/' + r.id) +
            '" target="_blank" rel="noopener">' + (r.thumb ? '<img src="' + esc(r.thumb) + '" alt="">' : '') +
            '<span class="cc-vmodal__fallbackBtn">▶ ' + esc(T.watch) + '</span></a>';
        }
        Array.prototype.forEach.call(box.querySelectorAll('.cc-reel'), function (x) { x.classList.remove('cc-reel--active'); });
        b.classList.add('cc-reel--active');
        // прокрутити плеєр у поле зору на мобільному
        var boxTop = document.querySelector('.cc-vmodal__box');
        if (boxTop && window.innerWidth <= 760) boxTop.scrollTop = 0;
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('img[data-vimeo]'), function (img) {
      fetchVimeoThumb(img.getAttribute('data-vimeo'), function (t) { if (t) img.src = t; });
    });
  }

  function closeVideo() {
    var vm = document.getElementById('cc-vmodal');
    vm.classList.remove('is-open'); vm.setAttribute('aria-hidden', 'true');
    document.getElementById('cc-vplayer').innerHTML = '';
    if (!document.getElementById('cc-modal').classList.contains('is-open')) {
      document.body.style.overflow = '';
      document.body.classList.remove('no-scroll');
    }
  }

  // Публічний хук: відтворити довільне відео (напр. кнопка Showreel у hero).
  window.ContrabasCases = window.ContrabasCases || {};
  // Публічний хук: застосувати фільтр за категорією (для лінків «Що ми робимо» / hero).
  // Приймає 'all' або назву категорії. Якщо категорії ще немає серед кейсів —
  // кнопка все одно стає активною і сітка покаже «поки що немає кейсів».
  window.ContrabasCases.filter = function (cat) {
    activeFilter = cat || 'all';
    if (document.getElementById('cc-filters')) { renderFilters(); renderCases(); }
  };
  window.ContrabasCases.playVideo = function (url, extra) {
    var v = parseVideo(url);
    if (!v) { window.open(url, '_blank'); return; }
    var item = {
      provider: v.provider, video_id: v.id, video_url: url,
      thumb: v.thumb || '', category: (extra && extra.category) || '',
      name_uk: (extra && extra.name_uk) || '', name_en: (extra && extra.name_en) || '',
      year: (extra && extra.year) || '', placement: (extra && extra.placement) || '',
      desc_uk: (extra && extra.desc_uk) || '', desc_en: (extra && extra.desc_en) || ''
    };
    openVideo(item);
  };

  /* ============ Модалка керування ============ */
  function modalHtml() {
    return (
    '<div class="cc-modal" id="cc-modal" aria-hidden="true">' +
      '<div class="cc-modal__overlay" data-close="1"></div>' +
      '<div class="cc-modal__box" role="dialog" aria-modal="true">' +
        '<button type="button" class="cc-modal__x" data-close="1" aria-label="' + esc(T.close) + '">&times;</button>' +
        '<div class="cc-modal__head">' +
          '<button type="button" class="cc-modal__back" id="cc-back" style="display:none">' + esc(T.back) + '</button>' +
          '<h3 class="cc-modal__title" id="cc-modal-title"></h3>' +
        '</div>' +
        '<div class="cc-modal__body" id="cc-modal-body"></div>' +
      '</div>' +
    '</div>');
  }
  function wireModal() {
    var modal = document.getElementById('cc-modal');
    modal.addEventListener('click', function (e) { if (e.target.getAttribute('data-close')) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
    });
    document.getElementById('cc-back').addEventListener('click', screenChoose);
  }
  /* ---------- Пароль адмінки ----------
     Перевіряється на бекенді (action=check_password) — сам пароль ніколи не
     потрапляє у відповідь сайту. Успішний вхід запам'ятовується в localStorage,
     щоб не питати пароль щоразу на тому самому пристрої. */
  var ADMIN_AUTH_KEY = 'cx_admin_authed_v1';
  function isAdminAuthed() {
    try { return localStorage.getItem(ADMIN_AUTH_KEY) === '1'; } catch (e) { return false; }
  }
  function adminAuthSet(v) {
    try { if (v) localStorage.setItem(ADMIN_AUTH_KEY, '1'); else localStorage.removeItem(ADMIN_AUTH_KEY); } catch (e) {}
  }
  function screenPasswordGate() {
    setTitle(T.passTitle, false);
    body().innerHTML =
      '<form class="cc-form" id="cc-gate-form" autocomplete="off">' +
        '<div class="cc-grid">' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.passLabel) + '</label>' +
            '<input type="password" name="password" autocomplete="off" autofocus /></div>' +
        '</div>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-gate-submit">' + esc(T.passSubmit) + '</button>' +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';
    var input = document.querySelector('#cc-gate-form input[name="password"]');
    if (input) setTimeout(function () { input.focus(); }, 50);
    document.getElementById('cc-gate-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var pass = input.value;
      if (!pass) { setStatus(T.passNeed, 'err'); return; }
      setStatus(T.saving, 'load');
      var btn = document.getElementById('cc-gate-submit'); if (btn) btn.disabled = true;
      jsonp({ action: 'check_password', password: pass }).then(function (res) {
        if (btn) btn.disabled = false;
        // Захист від застарілого/недеплоєного скрипта: якщо бекенд не знає дію
        // check_password, він падає у дефолтну гілку 'list' і поверне {ok:true,
        // items:[...]}. Справжня відповідь check_password НІКОЛИ не містить
        // items — тому приймаємо успіх лише за її відсутності.
        if (res && res.ok === true && !('items' in res)) {
          adminAuthSet(true);
          screenChoose();
        } else setStatus(T.passWrong, 'err');
      }).catch(function () { if (btn) btn.disabled = false; setStatus(T.loadErr, 'err'); });
    });
  }
  /* ---------- Прихований вхід в адмінку ----------
     Кнопки «Керувати кейсами» на видному місці більше немає — звичайний
     відвідувач її не бачить. Замовник відкриває адмінку 5-ма швидкими
     тапами/кліками по маленькому написові-«eyebrow» над заголовком
     портфоліо (на головній — «Наші кейси», на «Всі кейси» — «Портфоліо»).
     Елемент позначається атрибутом data-cc-admin-trigger — і в JS-розмітці
     тут, і статично в works.html/works-eng.html. */
  var adminTapCount = 0, adminTapTimer = null;
  function handleAdminTap() {
    adminTapCount++;
    clearTimeout(adminTapTimer);
    adminTapTimer = setTimeout(function () { adminTapCount = 0; }, 1500);
    if (adminTapCount >= 5) {
      adminTapCount = 0;
      clearTimeout(adminTapTimer);
      openModal();
    }
  }
  function attachAdminTriggers() {
    var els = document.querySelectorAll('[data-cc-admin-trigger]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-cc-admin-bound')) continue; // не дублюємо слухач
      els[i].setAttribute('data-cc-admin-bound', '1');
      els[i].addEventListener('click', handleAdminTap);
    }
  }

  function openModal() {
    var m = document.getElementById('cc-modal');
    modalSession++; // нова «сесія» відкриття — щоб відкладене автозакриття від старої дії не закрило заново відкрите вікно
    m.classList.add('is-open'); m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden'; document.body.classList.add('no-scroll');
    if (isAdminAuthed()) screenChoose(); else screenPasswordGate();
  }
  function closeModal() {
    var m = document.getElementById('cc-modal');
    m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true');
    if (!document.getElementById('cc-vmodal').classList.contains('is-open')) {
      document.body.style.overflow = '';
      document.body.classList.remove('no-scroll');
    }
  }
  function setTitle(t, showBack) {
    document.getElementById('cc-modal-title').textContent = t;
    document.getElementById('cc-back').style.display = showBack ? '' : 'none';
  }
  function body() { return document.getElementById('cc-modal-body'); }

  function screenChoose() {
    setTitle(T.chooseTitle, false);
    body().innerHTML =
      '<div class="cc-choose">' +
        '<button type="button" class="cc-choose__item" id="cc-go-add">' +
          '<span class="cc-choose__ico">+</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.chooseAdd) + '</b><i>' + esc(T.chooseAddSub) + '</i></span>' +
        '</button>' +
        '<button type="button" class="cc-choose__item" id="cc-go-edit">' +
          '<span class="cc-choose__ico">✎</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.chooseEdit) + '</b><i>' + esc(T.chooseEditSub) + '</i></span>' +
        '</button>' +
        '<button type="button" class="cc-choose__item" id="cc-go-about">' +
          '<span class="cc-choose__ico">i</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.chooseAbout) + '</b><i>' + esc(T.chooseAboutSub) + '</i></span>' +
        '</button>' +
        '<button type="button" class="cc-choose__item" id="cc-go-contacts">' +
          '<span class="cc-choose__ico">@</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.chooseContacts) + '</b><i>' + esc(T.chooseContactsSub) + '</i></span>' +
        '</button>' +
        '<button type="button" class="cc-choose__item" id="cc-go-hero">' +
          '<span class="cc-choose__ico">★</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.chooseHero) + '</b><i>' + esc(T.chooseHeroSub) + '</i></span>' +
        '</button>' +
        '<button type="button" class="cc-choose__item" id="cc-go-cats">' +
          '<span class="cc-choose__ico">#</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.chooseCats) + '</b><i>' + esc(T.chooseCatsSub) + '</i></span>' +
        '</button>' +
        '<button type="button" class="cc-choose__item" id="cc-go-services">' +
          '<span class="cc-choose__ico">▤</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.chooseServices) + '</b><i>' + esc(T.chooseServicesSub) + '</i></span>' +
        '</button>' +
        '<button type="button" class="cc-choose__item" id="cc-go-photos">' +
          '<span class="cc-choose__ico">🖼</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.choosePhotos) + '</b><i>' + esc(T.choosePhotosSub) + '</i></span>' +
        '</button>' +
        '<button type="button" class="cc-choose__item" id="cc-go-password">' +
          '<span class="cc-choose__ico">🔒</span>' +
          '<span class="cc-choose__txt"><b>' + esc(T.choosePassword) + '</b><i>' + esc(T.choosePasswordSub) + '</i></span>' +
        '</button>' +
      '</div>';
    document.getElementById('cc-go-add').addEventListener('click', function () { screenForm(null); });
    document.getElementById('cc-go-edit').addEventListener('click', screenList);
    document.getElementById('cc-go-about').addEventListener('click', screenAbout);
    document.getElementById('cc-go-contacts').addEventListener('click', screenContacts);
    document.getElementById('cc-go-hero').addEventListener('click', screenHero);
    document.getElementById('cc-go-cats').addEventListener('click', screenCategories);
    document.getElementById('cc-go-services').addEventListener('click', screenServices);
    document.getElementById('cc-go-photos').addEventListener('click', screenPhotos);
    document.getElementById('cc-go-password').addEventListener('click', screenPassword);
  }

  /* ---------- Екран: змінити пароль адмінки ---------- */
  function screenPassword() {
    setTitle(T.passScreenTitle, true);
    body().innerHTML =
      '<form class="cc-form" id="cc-pass-form" autocomplete="off">' +
        '<div class="cc-grid">' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.passCurrent) + '</label>' +
            '<input type="password" name="current_password" autocomplete="off" /></div>' +
          '<div class="cc-field cc-field--half"><label>' + esc(T.passNew) + '</label>' +
            '<input type="password" name="new_password" autocomplete="off" /></div>' +
          '<div class="cc-field cc-field--half"><label>' + esc(T.passNewRepeat) + '</label>' +
            '<input type="password" name="new_password2" autocomplete="off" /></div>' +
        '</div>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-pass-submit">' + esc(T.save) + '</button>' +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';
    document.getElementById('cc-pass-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var cur = f.elements['current_password'].value;
      var next = f.elements['new_password'].value;
      var next2 = f.elements['new_password2'].value;
      if (!next || next !== next2) { setStatus(T.passMismatch, 'err'); return; }
      setStatus(T.saving, 'load');
      var btn = document.getElementById('cc-pass-submit'); if (btn) btn.disabled = true;
      jsonp({ action: 'update_password', current_password: cur, new_password: next }).then(function (res) {
        if (btn) btn.disabled = false;
        if (res && res.ok) {
          setStatus(T.passSaved, 'ok');
          f.reset();
          adminAuthSet(true); // новий пароль уже підтверджений цим введенням поточного
        } else setStatus((res && res.error) ? res.error : T.loadErr, 'err');
      }).catch(function () { if (btn) btn.disabled = false; setStatus(T.loadErr, 'err'); });
    });
  }

  /* ---------- Екран: редагувати Hero (заголовок + опис) ---------- */
  function screenHero() {
    setTitle(T.heroScreenTitle, true);
    var h = SITE_HERO || {};
    // Фолбек із поточної сторінки (якщо бекенд ще не відповів) — щоб поля не були порожні.
    var domTitle = '', domLead = '';
    var tEl = document.getElementById('cx-hero-title');
    var lEl = document.getElementById('cx-hero-lead');
    if (tEl) domTitle = tEl.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    if (lEl) domLead = (lEl.textContent || '').trim();
    var g = function (k) {
      if (h[k]) return h[k];
      if (LANG === 'uk' && k === 'title_uk') return domTitle;
      if (LANG === 'en' && k === 'title_en') return domTitle;
      if (LANG === 'uk' && k === 'lead_uk') return domLead;
      if (LANG === 'en' && k === 'lead_en') return domLead;
      return '';
    };
    // Шоуріл не мовозалежний — uk/en однакові, беремо будь-яке заповнене поле.
    var showreelVal = h.showreel_url_uk || h.showreel_url_en || '';
    body().innerHTML =
      '<form class="cc-form" id="cc-hero-form" autocomplete="off">' +
        '<div class="cc-grid">' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.heroTitleUk) + '</label>' +
            '<textarea name="title_uk" rows="3">' + esc(g('title_uk')) + '</textarea></div>' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.heroTitleEn) + '</label>' +
            '<textarea name="title_en" rows="3">' + esc(g('title_en')) + '</textarea></div>' +
          '<div class="cc-field cc-field--full"><div class="cc-vhint">' + esc(T.heroHint) + '</div></div>' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.heroLeadUk) + '</label>' +
            '<textarea name="lead_uk" rows="3">' + esc(g('lead_uk')) + '</textarea></div>' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.heroLeadEn) + '</label>' +
            '<textarea name="lead_en" rows="3">' + esc(g('lead_en')) + '</textarea></div>' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.showreelLabel) + '</label>' +
            '<input type="text" name="showreel_url" value="' + esc(showreelVal) + '" placeholder="https://vimeo.com/… або https://youtu.be/…" />' +
            '<div class="cc-vhint">' + esc(T.showreelHint) + '</div></div>' +
        '</div>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-hero-submit">' + esc(T.save) + '</button>' +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';
    document.getElementById('cc-hero-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var showreel = f.elements['showreel_url'].value.trim();
      var vals = {
        title_uk: f.elements['title_uk'].value.trim(),
        title_en: f.elements['title_en'].value.trim(),
        lead_uk: f.elements['lead_uk'].value.trim(),
        lead_en: f.elements['lead_en'].value.trim(),
        showreel_url_uk: showreel, showreel_url_en: showreel
      };
      setStatus(T.saving, 'load');
      var btn = document.getElementById('cc-hero-submit'); if (btn) btn.disabled = true;
      var params = { action: 'update_hero' };
      Object.keys(vals).forEach(function (k) { params[k] = vals[k]; });
      jsonp(params).then(function (res) {
        if (btn) btn.disabled = false;
        if (res && res.ok) {
          setStatus(T.settingsSaved, 'ok');
          // Об'єднуємо, а не перезаписуємо — SITE_HERO містить ще й фото/сервіси.
          SITE_HERO = SITE_HERO || {};
          Object.keys(vals).forEach(function (k) { SITE_HERO[k] = vals[k]; });
          applyHeroToPage();
          syncSiteCache();
        } else setStatus((res && res.error) ? res.error : T.loadErr, 'err');
      }).catch(function () { if (btn) btn.disabled = false; setStatus(T.loadErr, 'err'); });
    });
  }

  /* ---------- Завантаження фото: читання + стиснення на клієнті ----------
     Перетягнутий JPG/PNG зчитуємо, зменшуємо через canvas до maxW (щоб файл був
     легким і не «плив»), перекодовуємо в JPEG. Повертаємо data:URL (base64). */
  function readAndResizeImage(file, maxW, cb, errCb) {
    if (!file || !/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) { errCb(T.photoBadType); return; }
    var reader = new FileReader();
    reader.onerror = function () { errCb(T.photoReadErr); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { errCb(T.photoBadType); };
      img.onload = function () {
        var scale = Math.min(1, maxW / (img.naturalWidth || maxW));
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var hgt = Math.max(1, Math.round(img.naturalHeight * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hgt;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hgt); // фон під можливу прозорість PNG
        ctx.drawImage(img, 0, 0, w, hgt);
        cb(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* Завантаження фото на бекенд (POST, бо base64 завеликий для JSONP/GET).
     Apps Script кладе файл на Google Drive і повертає пряме посилання. */
  function uploadImageFile(dataUrl, cb, errCb) {
    var m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl || '');
    if (!m) { errCb(T.photoUploadErr); return; }
    var payload = JSON.stringify({ action: 'upload_image', mime: m[1], data: m[2], name: 'site_photo' });
    // text/plain — щоб браузер НЕ робив CORS-preflight (Apps Script його не вміє).
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload, redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var res; try { res = JSON.parse(txt); } catch (e) { errCb(T.photoUploadErr); return; }
        if (res && res.ok && res.url) cb(res.url); else errCb((res && res.error) ? res.error : T.photoUploadErr);
      })
      .catch(function () { errCb(T.photoUploadErr); });
  }

  /* ---------- Екран: фото сайту (Hero-фон + фото «Про нас») ---------- */
  function screenPhotos() {
    setTitle(T.photosScreenTitle, true);
    var h = SITE_HERO || {};
    var heroPhotoEl = document.getElementById('cx-hero-img');
    var aboutPhotoEl = document.getElementById('cx-about-img');
    // Значення з таблиці (uk/en однакові — фото не залежить від мови), з фолбеком
    // на те, що зараз реально показано на сторінці.
    var heroVal = h.hero_photo_uk || h.hero_photo_en || '';
    var aboutVal = h.about_photo_uk || h.about_photo_en || '';

    function block(key, label, sizeHint, curSrc) {
      return '<div class="cc-field cc-field--full">' +
          '<label>' + esc(label) + '</label>' +
          '<div class="cc-drop" data-key="' + key + '">' +
            '<input type="file" accept="image/jpeg,image/png,image/webp" class="cc-drop__input" id="cc-drop-' + key + '" />' +
            '<div class="cc-drop__inner">' +
              '<div class="cc-drop__ico">⬆</div>' +
              '<div class="cc-drop__title">' + esc(T.dropTitle) + '</div>' +
              '<div class="cc-drop__sub">' + esc(T.dropSub) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="cc-vhint">' + esc(sizeHint) + '</div>' +
          '<div class="cc-photo-preview" id="cc-prev-' + key + '"' + (curSrc ? '' : ' style="display:none"') + '>' +
            '<span>' + esc(T.photoPreview) + '</span><img src="' + esc(curSrc || '') + '" alt="" />' +
          '</div>' +
          '<details class="cc-drop__url"><summary>' + esc(T.dropOr) + '</summary>' +
            '<input type="text" name="' + key + '_photo" value="' + esc(key === 'hero' ? heroVal : aboutVal) + '" placeholder="' + esc(T.photoUrlPh) + '" />' +
          '</details>' +
        '</div>';
    }

    body().innerHTML =
      '<form class="cc-form" id="cc-photos-form" autocomplete="off">' +
        '<div class="cc-grid">' +
          block('hero', T.heroPhotoLabel, T.heroPhotoSize, heroPhotoEl ? heroPhotoEl.src : '') +
          block('about', T.aboutPhotoLabel, T.aboutPhotoSize, aboutPhotoEl ? aboutPhotoEl.src : '') +
          '<div class="cc-field cc-field--full"><div class="cc-vhint">' + esc(T.photoHint) + '</div></div>' +
        '</div>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-photos-submit">' + esc(T.save) + '</button>' +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';

    // Максимальна ширина стиснення: hero — на весь екран, тому ширше.
    var MAXW = { hero: 2400, about: 1600 };

    function handleFile(key, file) {
      setStatus(T.uploading, 'load');
      readAndResizeImage(file, MAXW[key], function (dataUrl) {
        uploadImageFile(dataUrl, function (url) {
          // Заповнюємо приховане поле-посилання + оновлюємо прев'ю одразу.
          var input = document.querySelector('input[name="' + key + '_photo"]');
          if (input) input.value = url;
          var prev = document.getElementById('cc-prev-' + key);
          if (prev) { prev.style.display = ''; prev.querySelector('img').src = url; }
          setStatus(T.uploaded, 'ok');
        }, function (msg) { setStatus(msg || T.photoUploadErr, 'err'); });
      }, function (msg) { setStatus(msg || T.photoReadErr, 'err'); });
    }

    // Drag & drop + клік для кожної зони.
    Array.prototype.forEach.call(document.querySelectorAll('.cc-drop'), function (zone) {
      var key = zone.getAttribute('data-key');
      var input = zone.querySelector('.cc-drop__input');
      zone.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
      input.addEventListener('change', function () { if (input.files && input.files[0]) handleFile(key, input.files[0]); });
      ['dragenter', 'dragover'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.add('is-drag'); });
      });
      ['dragleave', 'dragend'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.remove('is-drag'); });
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation(); zone.classList.remove('is-drag');
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files[0]) handleFile(key, files[0]);
      });
    });

    document.getElementById('cc-photos-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var heroUrl = f.elements['hero_photo'].value.trim();
      var aboutUrl = f.elements['about_photo'].value.trim();
      // Фото не мовозалежне — записуємо однакове значення в uk/en поля.
      var params = {
        action: 'update_hero',
        hero_photo_uk: heroUrl, hero_photo_en: heroUrl,
        about_photo_uk: aboutUrl, about_photo_en: aboutUrl
      };
      setStatus(T.saving, 'load');
      var btn = document.getElementById('cc-photos-submit'); if (btn) btn.disabled = true;
      jsonp(params).then(function (res) {
        if (btn) btn.disabled = false;
        if (res && res.ok) {
          setStatus(T.settingsSaved, 'ok');
          SITE_HERO = SITE_HERO || {};
          SITE_HERO.hero_photo_uk = heroUrl; SITE_HERO.hero_photo_en = heroUrl;
          SITE_HERO.about_photo_uk = aboutUrl; SITE_HERO.about_photo_en = aboutUrl;
          applyHeroToPage();
          syncSiteCache();
        } else setStatus((res && res.error) ? res.error : T.loadErr, 'err');
      }).catch(function () { if (btn) btn.disabled = false; setStatus(T.loadErr, 'err'); });
    });
  }

  /* ---------- Екран: категорії проєктів (додати / змінити / видалити) ---------- */
  function screenCategories() {
    setTitle(T.catsScreenTitle, true);
    body().innerHTML =
      '<form class="cc-form" id="cc-cats-form" autocomplete="off">' +
        '<div class="cc-vhint">' + esc(T.catsHint) + '</div>' +
        '<div class="cc-cats" id="cc-cats"></div>' +
        '<button type="button" class="cc-addvid" id="cc-addcat">' + esc(T.addCat) + '</button>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-cats-submit">' + esc(T.save) + '</button>' +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';
    var list = (CATEGORIES && CATEGORIES.length) ? CATEGORIES.slice() : [''];
    list.forEach(function (c) { addCatRow(c); });
    document.getElementById('cc-addcat').addEventListener('click', function () { addCatRow(''); focusLastCat(); });
    document.getElementById('cc-cats-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var vals = Array.prototype.slice.call(document.querySelectorAll('#cc-cats .cc-catinput'))
        .map(function (el) { return el.value.trim(); }).filter(Boolean);
      // прибираємо дублікати (без урахування регістру), зберігаємо порядок
      var seen = {}, out = [];
      vals.forEach(function (v) { var k = v.toLowerCase(); if (!seen[k]) { seen[k] = true; out.push(v); } });
      if (!out.length) { setStatus(T.needCats, 'err'); return; }
      setStatus(T.saving, 'load');
      var btn = document.getElementById('cc-cats-submit'); if (btn) btn.disabled = true;
      jsonp({ action: 'update_categories', categories: out.join('\n') }).then(function (res) {
        if (btn) btn.disabled = false;
        if (res && res.ok) {
          setStatus(T.settingsSaved, 'ok');
          CATEGORIES = (res.categories && res.categories.length) ? res.categories.slice() : out;
          renderFilters(); renderCases(); renderHeroList();
          syncSiteCache();
        } else setStatus((res && res.error) ? res.error : T.loadErr, 'err');
      }).catch(function () { if (btn) btn.disabled = false; setStatus(T.loadErr, 'err'); });
    });
  }
  function addCatRow(val) {
    var box = document.getElementById('cc-cats');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'cc-catrow';
    row.innerHTML =
      '<input type="text" class="cc-catinput" value="' + esc(val || '') + '" placeholder="' + esc(T.catPh) + '">' +
      '<button type="button" class="cc-vrow__del" title="' + esc(T.del) + '">&times;</button>';
    row.querySelector('.cc-vrow__del').addEventListener('click', function () { row.parentNode.removeChild(row); });
    box.appendChild(row);
  }
  function focusLastCat() {
    var inputs = document.querySelectorAll('#cc-cats .cc-catinput');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  /* ---------- Екран: секція «Що ми робимо» (заголовок + картки послуг) ---------- */
  function screenServices() {
    setTitle(T.servicesScreenTitle, true);
    var h = SITE_HERO || {};
    // Фолбек заголовка/підпису з поточної сторінки, якщо бекенд ще не відповів.
    var domEyebrow = '', domTitle = '';
    var eEl = document.getElementById('cx-services-eyebrow');
    var tEl = document.getElementById('cx-services-title');
    if (eEl) domEyebrow = (eEl.textContent || '').trim();
    if (tEl) domTitle = tEl.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    var gEyebrow = (LANG === 'en' ? h.services_eyebrow_en : h.services_eyebrow_uk) || domEyebrow;
    var gTitle = (LANG === 'en' ? h.services_title_en : h.services_title_uk) || domTitle;
    var otherEyebrow = (LANG === 'en' ? h.services_eyebrow_uk : h.services_eyebrow_en) || '';
    var otherTitle = (LANG === 'en' ? h.services_title_uk : h.services_title_en) || '';

    body().innerHTML =
      '<form class="cc-form" id="cc-svc-form" autocomplete="off">' +
        '<div class="cc-vhint">' + esc(T.svcHeadHint) + '</div>' +
        '<div class="cc-grid">' +
          inp('svc_eyebrow_' + LANG, (LANG === 'en' ? T.svcEyebrowEn : T.svcEyebrowUk), gEyebrow, false, 'half') +
          inp('svc_eyebrow_o', (LANG === 'en' ? T.svcEyebrowUk : T.svcEyebrowEn), otherEyebrow, false, 'half') +
          area('svc_title_' + LANG, (LANG === 'en' ? T.svcTitleEn : T.svcTitleUk), gTitle, 'half') +
          area('svc_title_o', (LANG === 'en' ? T.svcTitleUk : T.svcTitleEn), otherTitle, 'half') +
        '</div>' +
        '<div class="cc-field cc-field--full" style="margin-top:6px"><label>' + esc(T.svcCards) + '</label>' +
          '<div class="cc-vhint">' + esc(T.svcHint) + '</div></div>' +
        '<div class="cc-svc-list" id="cc-svc-list"></div>' +
        '<button type="button" class="cc-addvid" id="cc-add-svc">' + esc(T.addSvc) + '</button>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-svc-submit">' + esc(T.save) + '</button>' +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';

    var cards = (SITE_SERVICES && SITE_SERVICES.length) ? SITE_SERVICES.slice() : [{}];
    cards.forEach(function (c) { addServiceRow(c); });
    document.getElementById('cc-add-svc').addEventListener('click', function () { addServiceRow({}); });
    document.getElementById('cc-svc-form').addEventListener('submit', onServicesSubmit);
  }

  function catOptionsFor(sel) {
    var opts = '<option value="all"' + (sel === 'all' || !sel ? ' selected' : '') + '>' + esc(T.svcAll) + '</option>';
    CATEGORIES.forEach(function (c) {
      opts += '<option value="' + esc(c) + '"' + (sel === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    });
    // Якщо збережений фільтр не входить у поточні категорії — все одно показуємо його.
    if (sel && sel !== 'all' && CATEGORIES.indexOf(sel) < 0) {
      opts += '<option value="' + esc(sel) + '" selected>' + esc(sel) + '</option>';
    }
    return opts;
  }
  var SERVICES_MAX = 6; // стільки ж, скільки і унікальних іконок
  function addServiceRow(c) {
    var box = document.getElementById('cc-svc-list');
    if (!box) return;
    // Максимум 6 карток послуг — під сітку та набір іконок.
    if (box.querySelectorAll('.cc-svc-row').length >= SERVICES_MAX) {
      var st = document.getElementById('cc-status');
      if (st) st.textContent = T.svcMax;
      return;
    }
    c = c || {};
    var row = document.createElement('div');
    row.className = 'cc-svc-row';
    row.innerHTML =
      '<button type="button" class="cc-svc-row__del cc-vrow__del" title="' + esc(T.svcRemove) + '">&times;</button>' +
      '<div class="cc-grid">' +
        inp('tag_' + LANG, (LANG === 'en' ? 'Tag (EN)' : T.svcTag), (LANG === 'en' ? c.tag_en : c.tag_uk) || '', false, 'half') +
        inp('tag_o', (LANG === 'en' ? T.svcTag : 'Tag (EN)'), (LANG === 'en' ? c.tag_uk : c.tag_en) || '', false, 'half') +
        inp('name_' + LANG, (LANG === 'en' ? 'Name (EN)' : T.svcName), (LANG === 'en' ? c.name_en : c.name_uk) || '', false, 'half') +
        inp('name_o', (LANG === 'en' ? T.svcName : 'Name (EN)'), (LANG === 'en' ? c.name_uk : c.name_en) || '', false, 'half') +
        area('desc_' + LANG, T.svcDescLbl + (LANG === 'en' ? ' (EN)' : ' (UA)'), (LANG === 'en' ? c.desc_en : c.desc_uk) || '', 'half') +
        area('desc_o', T.svcDescLbl + (LANG === 'en' ? ' (UA)' : ' (EN)'), (LANG === 'en' ? c.desc_uk : c.desc_en) || '', 'half') +
        '<div class="cc-field cc-field--full"><label>' + esc(T.svcFilter) + '</label>' +
          '<select name="filter">' + catOptionsFor(c.filter) + '</select></div>' +
      '</div>';
    row.querySelector('.cc-svc-row__del').addEventListener('click', function () { row.parentNode.removeChild(row); });
    box.appendChild(row);
  }
  function onServicesSubmit(e) {
    e.preventDefault();
    var f = e.target;
    // Заголовок/підпис секції
    var eyebrowThis = f.elements['svc_eyebrow_' + LANG].value.trim();
    var eyebrowOther = f.elements['svc_eyebrow_o'].value.trim();
    var titleThis = f.elements['svc_title_' + LANG].value.trim();
    var titleOther = f.elements['svc_title_o'].value.trim();
    // Картки
    var rows = Array.prototype.slice.call(document.querySelectorAll('#cc-svc-list .cc-svc-row'));
    var cards = [];
    rows.forEach(function (row) {
      var g = function (n) { var el = row.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ''; };
      var thisTag = g('tag_' + LANG), otherTag = g('tag_o');
      var thisName = g('name_' + LANG), otherName = g('name_o');
      var thisDesc = g('desc_' + LANG), otherDesc = g('desc_o');
      var filter = g('filter') || 'all';
      var card = { filter: filter };
      if (LANG === 'en') {
        card.tag_en = thisTag; card.tag_uk = otherTag; card.name_en = thisName; card.name_uk = otherName; card.desc_en = thisDesc; card.desc_uk = otherDesc;
      } else {
        card.tag_uk = thisTag; card.tag_en = otherTag; card.name_uk = thisName; card.name_en = otherName; card.desc_uk = thisDesc; card.desc_en = otherDesc;
      }
      if (card.name_uk || card.name_en || card.tag_uk || card.tag_en) cards.push(card);
    });
    if (!cards.length) { setStatus(T.needSvc, 'err'); return; }

    setStatus(T.saving, 'load');
    var btn = document.getElementById('cc-svc-submit'); if (btn) btn.disabled = true;
    // Готуємо параметри заголовка секції (через update_hero: ключі services_*).
    var heroParams = { action: 'update_hero' };
    if (LANG === 'en') {
      heroParams.services_eyebrow_en = eyebrowThis; heroParams.services_eyebrow_uk = eyebrowOther;
      heroParams.services_title_en = titleThis; heroParams.services_title_uk = titleOther;
    } else {
      heroParams.services_eyebrow_uk = eyebrowThis; heroParams.services_eyebrow_en = eyebrowOther;
      heroParams.services_title_uk = titleThis; heroParams.services_title_en = titleOther;
    }
    jsonp(heroParams).then(function () {
      return jsonp({ action: 'update_services', services: JSON.stringify(cards) });
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res && res.ok) {
        setStatus(T.settingsSaved, 'ok');
        // Оновлюємо локальний стан і сторінку одразу.
        SITE_HERO = SITE_HERO || {};
        SITE_HERO['services_eyebrow_uk'] = heroParams.services_eyebrow_uk; SITE_HERO['services_eyebrow_en'] = heroParams.services_eyebrow_en;
        SITE_HERO['services_title_uk'] = heroParams.services_title_uk; SITE_HERO['services_title_en'] = heroParams.services_title_en;
        SITE_SERVICES = (res.services && res.services.length) ? res.services.slice() : cards;
        applyServicesHead(); renderServicesCards();
        syncSiteCache();
      } else setStatus((res && res.error) ? res.error : T.loadErr, 'err');
    }).catch(function () { if (btn) btn.disabled = false; setStatus(T.loadErr, 'err'); });
  }

  /* ---------- Екран: редагувати текст "Про нас" ---------- */
  function screenAbout() {
    setTitle(T.chooseAbout, true);
    var uk = (SITE_ABOUT && SITE_ABOUT.uk) || '';
    var en = (SITE_ABOUT && SITE_ABOUT.en) || '';
    body().innerHTML =
      '<form class="cc-form" id="cc-about-form" autocomplete="off">' +
        '<div class="cc-grid">' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.aboutTextUk) + '</label>' +
            '<textarea name="text_uk" rows="7">' + esc(uk) + '</textarea></div>' +
          '<div class="cc-field cc-field--full"><label>' + esc(T.aboutTextEn) + '</label>' +
            '<textarea name="text_en" rows="7">' + esc(en) + '</textarea></div>' +
        '</div>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-about-submit">' + esc(T.save) + '</button>' +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';
    document.getElementById('cc-about-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var text_uk = f.elements['text_uk'].value.trim();
      var text_en = f.elements['text_en'].value.trim();
      setStatus(T.saving, 'load');
      var btn = document.getElementById('cc-about-submit'); if (btn) btn.disabled = true;
      jsonp({ action: 'update_about', text_uk: text_uk, text_en: text_en }).then(function (res) {
        if (btn) btn.disabled = false;
        if (res && res.ok) {
          setStatus(T.settingsSaved, 'ok');
          SITE_ABOUT = { uk: text_uk, en: text_en };
          applyAboutToPage();
          syncSiteCache();
        } else setStatus((res && res.error) ? res.error : T.loadErr, 'err');
      }).catch(function () { if (btn) btn.disabled = false; setStatus(T.loadErr, 'err'); });
    });
  }

  /* ---------- Екран: редагувати контакти ---------- */
  function screenContacts() {
    setTitle(T.chooseContacts, true);
    var c = SITE_CONTACTS || {};
    var g = function (k) { return c[k] || ''; };
    body().innerHTML =
      '<form class="cc-form" id="cc-contacts-form" autocomplete="off">' +
        '<div class="cc-grid">' +
          inp('phone', T.cPhone, g('phone'), false, 'half', '+380...') +
          inp('phone_display', T.cPhoneDisplay, g('phone_display'), false, 'half', '+38 0..') +
          inp('manager', T.cManager, g('manager'), false, 'half') +
          inp('email', T.cEmail, g('email'), false, 'half') +
          inp('address_uk', T.cAddrUk, g('address_uk'), false, 'full') +
          inp('address_en', T.cAddrEn, g('address_en'), false, 'full') +
          inp('instagram', T.cInstagram, g('instagram'), false, 'half') +
          inp('instagram_agency', T.cInstagramAgency, g('instagram_agency'), false, 'half') +
          inp('instagram_person', T.cInstagramPerson, g('instagram_person'), false, 'half') +
          inp('youtube', T.cYoutube, g('youtube'), false, 'half') +
          inp('vimeo', T.cVimeo, g('vimeo'), false, 'half') +
          inp('facebook', T.cFacebook, g('facebook'), false, 'full') +
        '</div>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-contacts-submit">' + esc(T.save) + '</button>' +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';
    var keys = ['phone', 'phone_display', 'manager', 'email', 'address_uk', 'address_en',
                'instagram', 'instagram_agency', 'instagram_person', 'youtube', 'vimeo', 'facebook'];
    document.getElementById('cc-contacts-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var vals = {};
      keys.forEach(function (k) { vals[k] = f.elements[k].value.trim(); });
      setStatus(T.saving, 'load');
      var btn = document.getElementById('cc-contacts-submit'); if (btn) btn.disabled = true;
      var params = { action: 'update_contacts' };
      keys.forEach(function (k) { params[k] = vals[k]; });
      jsonp(params).then(function (res) {
        if (btn) btn.disabled = false;
        if (res && res.ok) {
          setStatus(T.settingsSaved, 'ok');
          SITE_CONTACTS = vals;
          applyContactsToPage();
          syncSiteCache();
        } else setStatus((res && res.error) ? res.error : T.loadErr, 'err');
      }).catch(function () { if (btn) btn.disabled = false; setStatus(T.loadErr, 'err'); });
    });
  }

  function screenList() {
    setTitle(T.listTitle, true);
    if (!ALL.length) { body().innerHTML = '<div class="cc-modal__empty">' + esc(T.noCases) + '</div>'; return; }
    var rows = ALL.map(function (i) {
      var title = pick(i, 'name_uk', 'name_en');
      var th = thumbOf(i);
      var rvi = resolveVideo(i);
      var im = th ? '<img src="' + esc(th) + '" alt="">'
        : (rvi && rvi.provider === 'vimeo' ? '<img alt="" data-vimeo="' + esc(rvi.id) + '">' : '');
      return '<div class="cc-litem" data-id="' + esc(i.id) + '">' +
        '<div class="cc-litem__thumb">' + im + '</div>' +
        '<div class="cc-litem__meta"><b>' + esc(title || '—') + '</b><i>' + esc(i.category || '') +
          (i.year ? ' · ' + esc(i.year) : '') + '</i></div>' +
        '<div class="cc-litem__actions">' +
          '<button type="button" class="cc-mini" data-edit="' + esc(i.id) + '">' + esc(T.edit) + '</button>' +
          '<button type="button" class="cc-mini cc-mini--danger" data-del="' + esc(i.id) + '">' + esc(T.del) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
    body().innerHTML = '<div class="cc-list">' + rows + '</div>';
    Array.prototype.forEach.call(body().querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () { screenForm(b.getAttribute('data-edit')); });
    });
    Array.prototype.forEach.call(body().querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () { doDelete(b.getAttribute('data-del')); });
    });
    Array.prototype.forEach.call(body().querySelectorAll('img[data-vimeo]'), function (img) {
      fetchVimeoThumb(img.getAttribute('data-vimeo'), function (t) { if (t) img.src = t; });
    });
  }

  function screenForm(id) {
    editingId = id;
    var it = id ? ALL.filter(function (x) { return String(x.id) === String(id); })[0] : null;
    setTitle(id ? T.editTitle : T.addTitle, true);
    var catOpts = CATEGORIES.map(function (c) {
      return '<option value="' + esc(c) + '"' + (it && it.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var g = function (k) { return it ? (it[k] || '') : ''; };

    body().innerHTML =
      '<form class="cc-form" id="cc-form" autocomplete="off">' +
        '<div class="cc-grid">' +
          inp('name_uk', T.nameUk, g('name_uk'), true, 'half') +
          inp('name_en', T.nameEn, g('name_en'), false, 'half') +
          // Динамічний список відео (перше — обкладинка, усі — сітка роликів)
          '<div class="cc-field cc-field--full">' +
            '<label>' + T.videosLabel + ' <span class="cc-req">*</span></label>' +
            '<div class="cc-vhint">' + esc(T.videosHint) + '</div>' +
            '<div class="cc-videos" id="cc-videos"></div>' +
            '<button type="button" class="cc-addvid" id="cc-addvid">+ ' + esc(T.addVideo) + '</button>' +
          '</div>' +
          // Якщо категорії ще не завантажилися (рідкісний офлайн-випадок) — текстове
          // поле замість select, щоб форма не була заблокована повністю.
          '<div class="cc-field cc-field--half"><label>' + T.category + '</label>' +
            (CATEGORIES.length
              ? '<select name="category">' + catOpts + '</select>'
              : '<input type="text" name="category" value="' + esc(g('category')) + '" placeholder="Commercial" />') +
          '</div>' +
          inp('year', T.year, g('year'), false, 'half', '2024') +
          inp('placement', T.placement, g('placement'), false, 'full', T.placementPh) +
          area('desc_uk', T.descUk, g('desc_uk'), 'half') +
          area('desc_en', T.descEn, g('desc_en'), 'half') +
          '<div class="cc-field cc-field--full"><div class="cc-vhint">' + esc(T.descHint) + '</div></div>' +
        '</div>' +
        '<div class="cc-form-actions">' +
          '<button type="submit" class="cc-btn" id="cc-submit">' + (id ? T.saveEdit : T.save) + '</button>' +
          (id ? '<button type="button" class="cc-btn cc-btn--danger" id="cc-del">' + T.del + '</button>' : '') +
          '<span class="cc-status" id="cc-status"></span>' +
        '</div>' +
      '</form>';

    // початковий список URL відео для форми
    initVideoRows(collectInitialVideos(it));
    document.getElementById('cc-addvid').addEventListener('click', function () { addVideoRow(''); });

    var form = document.getElementById('cc-form');
    form.addEventListener('submit', function (e) { e.preventDefault(); doSave(form); });
    if (id) document.getElementById('cc-del').addEventListener('click', function () { doDelete(id); });
  }

  /* --------- Динамічний список відео у формі --------- */
  // Збираємо початкові URL кейсу: спочатку reels (усі відео), інакше — головне відео.
  function collectInitialVideos(it) {
    if (!it) return [''];
    var urls = [];
    if (it.reels) {
      urls = String(it.reels).split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    if (it.video_url) {
      // головне відео має бути першим і не дублюватися
      var mainV = parseVideo(it.video_url);
      var exists = urls.some(function (u) { var v = parseVideo(u); return v && mainV && v.id === mainV.id; });
      if (!exists) urls.unshift(it.video_url);
    }
    return urls.length ? urls : [''];
  }
  function initVideoRows(urls) {
    var box = document.getElementById('cc-videos');
    if (box) box.innerHTML = '';
    (urls && urls.length ? urls : ['']).forEach(function (u) { addVideoRow(u); });
    updateVideoRowsUI();
  }
  function addVideoRow(url) {
    var box = document.getElementById('cc-videos');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'cc-vrow';
    row.innerHTML =
      '<span class="cc-vrow__thumb"><img alt=""></span>' +
      '<div class="cc-vrow__main">' +
        '<input type="text" class="cc-vinput" value="' + esc(url || '') + '" placeholder="https://youtu.be/…  ·  https://vimeo.com/…">' +
        '<span class="cc-vrow__meta"></span>' +
      '</div>' +
      '<button type="button" class="cc-vrow__del" title="' + esc(T.del) + '">&times;</button>';
    box.appendChild(row);
    var input = row.querySelector('.cc-vinput');
    var pt;
    input.addEventListener('input', function () { clearTimeout(pt); pt = setTimeout(function () { updateRowPreview(row); }, 300); });
    row.querySelector('.cc-vrow__del').addEventListener('click', function () {
      row.parentNode.removeChild(row); updateVideoRowsUI();
    });
    updateRowPreview(row);
    updateVideoRowsUI();
    return row;
  }
  function updateRowPreview(row) {
    var input = row.querySelector('.cc-vinput');
    var img = row.querySelector('.cc-vrow__thumb img');
    var meta = row.querySelector('.cc-vrow__meta');
    var v = parseVideo(input.value);
    if (!v) { row.classList.remove('cc-on'); img.removeAttribute('src'); meta.textContent = ''; return; }
    row.classList.add('cc-on');
    meta.innerHTML = '<b>' + v.provider.toUpperCase() + '</b> · ' + esc(v.id);
    if (v.provider === 'youtube') img.src = v.thumb;
    else { img.removeAttribute('src'); fetchVimeoThumb(v.id, function (t) { if (t) img.src = t; }); }
  }
  // Оновлюємо мітки «Обкладинка / Ролик N» + доступність кнопки видалення.
  function updateVideoRowsUI() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#cc-videos .cc-vrow'));
    rows.forEach(function (row, i) {
      row.classList.toggle('cc-vrow--cover', i === 0);
      var del = row.querySelector('.cc-vrow__del');
      if (del) del.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
    });
  }
  function collectVideoUrls() {
    return Array.prototype.slice.call(document.querySelectorAll('#cc-videos .cc-vinput'))
      .map(function (el) { return el.value.trim(); }).filter(Boolean);
  }

  function inp(name, label, val, req, size, ph) {
    return '<div class="cc-field cc-field--' + size + '"><label>' + esc(label) +
      (req ? ' <span class="cc-req">*</span>' : '') + '</label>' +
      '<input type="text" name="' + name + '" value="' + esc(val) + '"' +
      (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></div>';
  }
  function area(name, label, val, size) {
    return '<div class="cc-field cc-field--' + size + '"><label>' + esc(label) + '</label>' +
      '<textarea name="' + name + '" rows="4">' + esc(val) + '</textarea></div>';
  }


  function setStatus(msg, type) {
    var el = document.getElementById('cc-status');
    if (el) { el.className = 'cc-status cc-status--' + type; el.textContent = msg; }
  }

  /* ---------------- Дії ---------------- */
  function doSave(form) {
    var d = {};
    ['name_uk', 'name_en', 'category', 'year', 'placement', 'desc_uk', 'desc_en'].forEach(function (k) {
      var el = form.elements[k]; d[k] = el ? el.value.trim() : '';
    });
    if (!d.name_uk) { setStatus(T.needName, 'err'); return; }

    // Усі відео кейсу (перше — обкладинка/головне, повний список — сітка роликів).
    var urls = collectVideoUrls();
    if (!urls.length) { setStatus(T.needUrl, 'err'); return; }
    var parsed = [];
    for (var i = 0; i < urls.length; i++) {
      var pv = parseVideo(urls[i]);
      if (!pv) { setStatus(T.badUrl, 'err'); return; }
      parsed.push({ url: urls[i], v: pv });
    }
    var main = parsed[0];
    var v = main.v;
    // reels зберігаємо ЗАВЖДИ повний список (усі відео), навіть якщо воно одне —
    // так візуалізація й редагування працюють однаково.
    d.reels = urls.join('\n');

    setStatus(T.saving, 'load');
    var btn = document.getElementById('cc-submit');
    if (btn) btn.disabled = true;

    if (v.provider === 'vimeo') fetchVimeoThumb(v.id, function (thumb) { send(thumb || ''); });
    else send(v.provider === 'youtube' ? v.thumb : '');

    function send(thumb) {
      var params = {
        action: editingId ? 'update' : 'add',
        name_uk: d.name_uk, name_en: d.name_en, video_url: main.url,
        provider: v.provider, video_id: v.id, thumb: thumb || '',
        category: d.category, year: d.year, placement: d.placement,
        desc_uk: d.desc_uk, desc_en: d.desc_en, reels: d.reels
      };
      if (editingId) params.id = editingId;
      function unlock() { var b = document.getElementById('cc-submit'); if (b) b.disabled = false; }
      jsonp(params).then(function (res) {
        unlock();
        if (res && res.ok) {
          setStatus(T.saved, 'ok');
          // Оптимістично оновлюємо ALL одразу (без очікування перезавантаження),
          // щоб публічна сітка миттєво показала реальний кейс замість демо-набору.
          applyLocal(res.id || editingId, params, thumb);
          renderFilters(); renderCases();
          var mySession = modalSession; // закриваємо лише якщо користувач не відкрив вікно заново
          return loadCases().then(function () {
            setTimeout(function () { if (mySession === modalSession) closeModal(); }, 500);
          });
        }
        setStatus((res && res.error) ? res.error : T.loadErr, 'err');
      }).catch(function () { unlock(); setStatus(T.loadErr, 'err'); });
    }
  }

  function doDelete(id) {
    if (!window.confirm(T.confirmDel)) return;
    setStatus(T.deleting, 'load');
    jsonp({ action: 'delete', id: id }).then(function (res) {
      if (res && res.ok) {
        // Оптимістично прибираємо кейс з ALL, оновлюємо сітку одразу.
        ALL = ALL.filter(function (x) { return String(x.id) !== String(id); });
        renderFilters(); renderCases();
        return loadCases().then(function () {
          if (document.getElementById('cc-modal').classList.contains('is-open')) screenList();
        });
      }
      setStatus((res && res.error) ? res.error : T.loadErr, 'err');
    }).catch(function () { setStatus(T.loadErr, 'err'); });
  }

  // Локальне застосування add/update у ALL до перезавантаження з бекенду.
  function applyLocal(id, params, thumb) {
    var rec = {
      id: id, name_uk: params.name_uk, name_en: params.name_en,
      category: params.category, year: params.year, placement: params.placement,
      provider: params.provider, video_id: params.video_id, video_url: params.video_url,
      thumb: thumb || params.thumb || '', desc_uk: params.desc_uk, desc_en: params.desc_en,
      reels: params.reels || ''
    };
    var idx = -1;
    for (var i = 0; i < ALL.length; i++) if (String(ALL[i].id) === String(id)) { idx = i; break; }
    if (idx >= 0) { for (var k in rec) ALL[idx][k] = rec[k]; }
    else ALL.unshift(rec);
  }

  /* ---------------- Рендер сітки ---------------- */
  // Кеш застосовуємо миттєво лише на САМЕ ПЕРШЕ завантаження сторінки (щоб не
  // було «мигання» до відповіді таблиці). При повторних викликах (після
  // додавання/редагування/видалення кейсу, збереження hero тощо) кеш більше НЕ
  // застосовуємо — інакше стара кешована відповідь могла б на мить перекрити
  // щойно оновлені дані ще до того, як прийде свіжа відповідь з таблиці.
  var casesBooted = false;
  var siteBooted = false;
  // Захист від «гонки»: loadCases() може бути викликаний повторно (напр. одразу
  // після додавання кейсу), поки попередній виклик ще очікує відповідь. Якщо
  // старіша відповідь приходить ПІЗНІШЕ новішої — вона ігнорується за номером.
  var casesReqSeq = 0;
  function loadCases() {
    var cached = null;
    if (!casesBooted) {
      casesBooted = true;
      cached = cacheGet('cases');
      if (cached && cached.items) { ALL = cached.items; renderFilters(); renderCases(); }
    }
    var mySeq = ++casesReqSeq;
    return jsonp({ action: 'list' }).then(function (res) {
      if (mySeq !== casesReqSeq) return; // застаріла відповідь — ігноруємо
      // Бекенд відповів — ALL = реальні кейси (для адмінки). Демо-набір не показуємо.
      backendFailed = false;
      ALL = (res && res.items) ? res.items : [];
      renderFilters(); renderCases();
      cacheSet('cases', { items: ALL });
    }).catch(function () {
      if (mySeq !== casesReqSeq) return;
      // Немає звʼязку з бекендом. Якщо є кеш — лишаємо його на екрані (вже показано
      // вище), інакше показуємо демо-набір, щоб сітка виглядала готовою.
      if (cached && cached.items) return;
      backendFailed = true;
      ALL = [];
      renderFilters(); renderCases();
    });
  }
  /* ---------------- "Про нас" + Контакти (Google Таблиця) ---------------- */
  // Після кожного успішного збереження в адмінці (about/contacts/hero/categories/
  // services) оновлюємо кеш 'site' поточним станом у пам'яті — щоб localStorage
  // одразу відображав щойно збережені дані, а не чекав наступного фонового fetch.
  function syncSiteCache() {
    cacheSet('site', {
      ok: true,
      about: SITE_ABOUT,
      contacts: SITE_CONTACTS,
      hero: SITE_HERO,
      categories: CATEGORIES,
      services: SITE_SERVICES,
      cases: ALL
    });
  }
  function applySiteData(res) {
    if (!res || !res.ok) return;
    if (res.about) { SITE_ABOUT = res.about; applyAboutToPage(); }
    if (res.contacts) { SITE_CONTACTS = res.contacts; applyContactsToPage(); }
    if (res.hero) { SITE_HERO = res.hero; applyHeroToPage(); applyServicesHead(); }
    if (res.categories && res.categories.length) CATEGORIES = res.categories.slice();
    if (res.services && res.services.length) { SITE_SERVICES = res.services.slice(); renderServicesCards(); }
    // getSite_() тепер повертає й кейси (action=site = ОДИН запит замість двох
    // окремих — швидше перше завантаження). Масив може бути й порожнім (реально
    // немає кейсів) — тому перевіряємо саме isArray, а не .length.
    if (Array.isArray(res.cases)) {
      casesBooted = true; backendFailed = false;
      ALL = res.cases;
      cacheSet('cases', { items: ALL });
    }
    renderFilters(); renderCases(); renderHeroList();
  }
  function loadSite() {
    var cached = null;
    if (!siteBooted) {
      siteBooted = true;
      cached = cacheGet('site');
      if (cached) applySiteData(cached);
    }
    return jsonp({ action: 'site' }).then(function (res) {
      applySiteData(res);
      if (res && res.ok) cacheSet('site', res);
    }).catch(function () { /* лишаємо кеш або статичний текст із HTML — нормальний fallback */ });
  }

  /* ---------------- Hero: заголовок + опис + список напрямків ---------------- */
  function applyHeroToPage() {
    if (!SITE_HERO) return;
    var title = pick(SITE_HERO, 'title_uk', 'title_en');
    var lead  = pick(SITE_HERO, 'lead_uk', 'lead_en');
    var tEl = document.getElementById('cx-hero-title');
    var lEl = document.getElementById('cx-hero-lead');
    if (tEl && title) {
      // Кожен рядок заголовка -> окремий рядок (br). Текст екрануємо.
      tEl.innerHTML = String(title).split(/\r?\n/).map(function (s) { return esc(s); }).join('<br>');
    }
    if (lEl && lead) lEl.textContent = lead;
    // Фото не мовозалежне — uk/en однакові, pick() тут просто бере те, що заповнене.
    var heroPhoto = pick(SITE_HERO, 'hero_photo_uk', 'hero_photo_en');
    var aboutPhoto = pick(SITE_HERO, 'about_photo_uk', 'about_photo_en');
    var heroImgEl = document.getElementById('cx-hero-img');
    var heroVideoEl = document.getElementById('cx-hero-video');
    if (heroPhoto) {
      if (heroImgEl) heroImgEl.src = heroPhoto;
      if (heroVideoEl) heroVideoEl.setAttribute('poster', heroPhoto);
    }
    var aboutImgEl = document.getElementById('cx-about-img');
    if (aboutPhoto && aboutImgEl) aboutImgEl.src = aboutPhoto;
    // Кнопка «Дивитись шоуріл» у hero — посилання на відео теж з таблиці.
    var showreelUrl = pick(SITE_HERO, 'showreel_url_uk', 'showreel_url_en');
    if (showreelUrl) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-video]'), function (btn) {
        btn.setAttribute('data-video', showreelUrl);
      });
    }
  }
  // Рендер списку напрямків у hero (справа). Показуємо НЕ БІЛЬШЕ 5 пунктів —
  // щоб при великій кількості категорій список не «плив» і не ламав макет;
  // повний перелік доступний у фільтрах кейсів. Клік -> фільтр + скрол.
  var HERO_LIST_MAX = 5;
  function renderHeroList() {
    var ul = document.getElementById('cx-hero-list');
    if (!ul) return; // тільки на index/eng, де є hero
    if (!CATEGORIES.length) { ul.innerHTML = ''; return; }
    var list = CATEGORIES.slice(0, HERO_LIST_MAX);
    ul.innerHTML = list.map(function (c, i) {
      var num = (i + 1 < 10 ? '0' : '') + (i + 1);
      // Hero є лише на головній — ведемо на повне портфоліо, відфільтроване по категорії.
      var href = viewAllHref() + '?cat=' + encodeURIComponent(c) + '#work';
      return '<li><a href="' + esc(href) + '"><span>' + esc(c) +
        '</span><span class="num">' + num + '</span></a></li>';
    }).join('');
  }

  /* ---------------- Секція «Що ми робимо» (services) ---------------- */
  // Іконки для карток послуг (6 преміальних SVG — по одній на кожну з максимум 6 карток).
  var SERVICE_ICONS = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 10.2h17v8.3a1 1 0 01-1 1h-15a1 1 0 01-1-1v-8.3z"/><path d="M3.7 10.2l1.2-4.4a1 1 0 011-.75h12.2a1 1 0 011 .75l1.2 4.4M6.8 5.3l3.2 4.9M11.4 5.1l3.2 4.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.7 19h2.6" stroke-linecap="round"/><path d="M10.3 8.8l4.2 2.7-4.2 2.7z" stroke-linejoin="round"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2.6a6.4 6.4 0 00-3.7 11.6c.6.4 1 1.1 1 1.9v.4h5.4v-.4c0-.8.4-1.5 1-1.9A6.4 6.4 0 0012 2.6z"/><path d="M9.3 19.5h5.4M10.2 21.4h3.6" stroke-linecap="round"/><path d="M12 6.3v3.4M9.3 10.9l1.9 1.9M14.7 10.9l-1.9 1.9" stroke-linecap="round"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><path d="M10 8.5l5 3.5-5 3.5z" stroke-linejoin="round"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h16v11H4z"/><path d="M9 20h6M8 16v4M16 16v4" stroke-linecap="round"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8.6" r="3.4"/><path d="M5.2 20.2a6.8 6.8 0 0113.6 0" stroke-linecap="round"/><path d="M17.6 3.9a4.6 4.6 0 010 6.4M20 2a8 8 0 010 10.2" stroke-linecap="round"/></svg>'
  ];
  // Заголовок + підпис секції беруться з листа hero (ключі services_*).
  function applyServicesHead() {
    if (!SITE_HERO) return;
    var eyebrow = pick(SITE_HERO, 'services_eyebrow_uk', 'services_eyebrow_en');
    var title = pick(SITE_HERO, 'services_title_uk', 'services_title_en');
    var eEl = document.getElementById('cx-services-eyebrow');
    var tEl = document.getElementById('cx-services-title');
    if (eEl && eyebrow) eEl.textContent = eyebrow;
    if (tEl && title) tEl.innerHTML = String(title).split(/\r?\n/).map(function (s) { return esc(s); }).join('<br>');
  }
  function renderServicesCards() {
    var box = document.getElementById('cx-services-cards');
    if (!box || !SITE_SERVICES || !SITE_SERVICES.length) return;
    box.innerHTML = SITE_SERVICES.slice(0, SERVICES_MAX).map(function (s, i) {
      var tag = pick(s, 'tag_uk', 'tag_en');
      var name = pick(s, 'name_uk', 'name_en');
      var desc = pick(s, 'desc_uk', 'desc_en');
      var filter = s.filter || 'all';
      var ico = SERVICE_ICONS[i % SERVICE_ICONS.length];
      // На головній (LIMIT) ведемо на повне портфоліо, одразу відфільтроване по
      // категорії, щоб «підтягнулися» всі роботи, а не лише 10 останніх. На самій
      // сторінці «Всі кейси» — фільтруємо на місці.
      var href = (LIMIT && filter && filter !== 'all')
        ? viewAllHref() + '?cat=' + encodeURIComponent(filter) + '#work'
        : (LIMIT ? viewAllHref() + '#work' : '#work');
      return '<div class="cx-service cx-reveal is-in">' +
        '<div class="cx-service__ico">' + ico + '</div>' +
        (tag ? '<span class="cx-service__tag">' + esc(tag) + '</span>' : '') +
        '<h3>' + esc(name || '') + '</h3>' +
        '<p>' + esc(desc || '') + '</p>' +
        '<a href="' + esc(href) + '" class="cx-service__more" data-filter="' + esc(filter) + '">' + esc(T.viewWork) + '</a>' +
      '</div>';
    }).join('');
    // На сторінці «Всі кейси» (без LIMIT) фільтруємо на місці; на головній лишаємо
    // звичайний перехід за href на повне портфоліо.
    if (!LIMIT) {
      Array.prototype.forEach.call(box.querySelectorAll('a[data-filter]'), function (a) {
        a.addEventListener('click', function () {
          var cat = a.getAttribute('data-filter') || 'all';
          window.ContrabasCases.filter(cat);
          setTimeout(function () { window.ContrabasCases.filter(cat); }, 400);
        });
      });
    }
  }
  function applyAboutToPage() {
    var el = document.getElementById('cx-about-text');
    if (!el || !SITE_ABOUT) return;
    var txt = pick(SITE_ABOUT, 'uk', 'en') || SITE_ABOUT.uk || SITE_ABOUT.en;
    if (!txt) return;
    el.innerHTML = String(txt).split(/\n{2,}/).map(function (p) {
      return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function applyContactsToPage() {
    var c = SITE_CONTACTS;
    if (!c) return;
    var addr = (LANG === 'en' && c.address_en) ? c.address_en : c.address_uk;
    function setText(id, val) { var e = document.getElementById(id); if (e && val) e.textContent = val; }
    function setHref(id, val, prefix) { var e = document.getElementById(id); if (e && val) e.setAttribute('href', (prefix || '') + val); }
    // Блок «Контакти»
    setHref('cx-contact-phone', c.phone, 'tel:'); setText('cx-contact-phone', c.phone_display || c.phone);
    setText('cx-contact-manager', c.manager);
    setHref('cx-contact-email', c.email, 'mailto:'); setText('cx-contact-email', c.email);
    setText('cx-contact-address', addr);
    setHref('cx-contact-s-instagram', c.instagram); setHref('cx-contact-s-instagram-agency', c.instagram_agency);
    setHref('cx-contact-s-instagram-person', c.instagram_person);
    setHref('cx-contact-s-youtube', c.youtube); setHref('cx-contact-s-vimeo', c.vimeo); setHref('cx-contact-s-facebook', c.facebook);
    // Футер
    setHref('cx-footer-phone', c.phone, 'tel:'); setText('cx-footer-phone', c.phone_display || c.phone);
    setText('cx-footer-manager', c.manager);
    setHref('cx-footer-email', c.email, 'mailto:'); setText('cx-footer-email', c.email);
    setText('cx-footer-address1', addr);
    setHref('cx-footer-s-instagram', c.instagram); setHref('cx-footer-s-instagram-agency', c.instagram_agency);
    setHref('cx-footer-s-instagram-person', c.instagram_person);
    setHref('cx-footer-s-youtube', c.youtube); setHref('cx-footer-s-vimeo', c.vimeo); setHref('cx-footer-s-facebook', c.facebook);
  }

  // Категорія = текст. Роки/числа у фільтр НЕ потрапляють (навіть якщо в даних
  // у стовпці category опинилося число). Так у селекторі завжди лише категорії.
  function isCategoryValue(c) {
    c = String(c == null ? '' : c).trim();
    if (!c) return false;
    if (/^\d+$/.test(c)) return false;              // чисте число (рік) — не категорія
    if (/^(19|20)\d{2}(\s*[-/–]\s*(19|20)?\d{2,4})?$/.test(c)) return false; // діапазон років
    return true;
  }
  function renderFilters() {
    var box = document.getElementById('cc-filters');
    // Кейсів взагалі ще немає (порожня таблиця/не завантажилась) — показувати
    // навігацію по категоріях нема сенсу, фільтрувати все одно нічого.
    if (!shown().length) { box.innerHTML = ''; return; }
    // Показуємо всі канонічні категорії (як у ТЗ/референсі), навіть якщо кейсів
    // у деяких ще немає — щоб навігація «Що ми робимо» / hero вела коректно.
    var cats = CATEGORIES.slice();
    shown().forEach(function (i) {
      var c = (i.category || '').trim();
      if (isCategoryValue(c) && cats.indexOf(c) < 0) cats.push(c);
    });
    // якщо активний фільтр — категорія поза списком, все одно додамо його
    if (activeFilter !== 'all' && cats.indexOf(activeFilter) < 0) cats.push(activeFilter);
    var html = fbtn('all', T.all);
    cats.forEach(function (c) { html += fbtn(c, catLabel(c)); });
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('.cc-filter'), function (b) {
      b.addEventListener('click', function () { activeFilter = b.getAttribute('data-f'); renderFilters(); renderCases(); });
    });
  }
  function fbtn(v, l) {
    return '<button type="button" class="cc-filter' + (activeFilter === v ? ' cc-active' : '') +
      '" data-f="' + esc(v) + '">' + esc(l) + '</button>';
  }
  // Категорії лишаються англійськими (як у референсі) в обох мовах.
  function catLabel(c) { return c; }
  function renderCases() {
    var box = document.getElementById('cc-cases');
    var items = shown().filter(function (i) { return activeFilter === 'all' || i.category === activeFilter; });
    if (LIMIT) items = items.slice(0, LIMIT);
    if (!items.length) { box.innerHTML = '<div class="cc-empty">' + T.empty + '</div>'; return; }
    box.innerHTML = items.map(function (i, idx) {
      var title = pick(i, 'name_uk', 'name_en');
      var th = thumbOf(i);
      var rvc = resolveVideo(i);
      var imgHtml = th ? '<img loading="lazy" src="' + esc(th) + '" alt="' + esc(title) + '">'
        : (rvc && rvc.provider === 'vimeo' ? '<img loading="lazy" alt="' + esc(title) + '" data-vimeo="' + esc(rvc.id) + '">' : '');
      var reelsCount = parseReels(i).length;
      return '<div class="cc-card" data-id="' + esc(i.id) + '" style="animation-delay:' + (idx * 55) + 'ms">' +
        '<div class="cc-thumb" title="' + esc(T.openCase) + '">' +
          imgHtml +
          (reelsCount >= 2 ? '<span class="cc-badge">' + reelsCount + ' ' + esc(T.videos) + '</span>' : '') +
          '<div class="cc-ov"><div class="cc-ov__box">' +
            '<span class="cc-ov__title">' + esc(title || '') + '</span>' +
            (i.year ? '<span class="cc-ov__year">' + esc(i.year) + '</span>' : '') +
            (i.placement ? '<span class="cc-ov__place">' + esc(i.placement) + '</span>' : '') +
          '</div></div>' +
        '</div>' +
        '<div class="cc-foot">' +
          '<div class="cc-title">' + esc(title || '') + '</div>' +
          '<div class="cc-foot__row">' +
            '<span class="cc-cat">' + esc(catLabel(i.category) || '') + '</span>' +
            '<span class="cc-open" data-open="' + esc(i.id) + '">' + esc(T.openCase) + ' <i>&rarr;</i></span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') + (LIMIT ? (
      '<a class="cc-card cc-card--more" href="' + esc(viewAllHref()) + '">' +
        '<div class="cc-thumb cc-thumb--more">' +
          '<span class="cc-card--more__ico">&rarr;</span>' +
        '</div>' +
        '<div class="cc-foot">' +
          '<div class="cc-title">' + esc(T.viewAll) + '</div>' +
          '<div class="cc-foot__row">' +
            '<span class="cc-cat">' + esc(T.eyebrow) + '</span>' +
          '</div>' +
        '</div>' +
      '</a>'
    ) : '');

    Array.prototype.forEach.call(box.querySelectorAll('.cc-card:not(.cc-card--more)'), function (card) {
      card.addEventListener('click', function () {
        var it = findShown(card.getAttribute('data-id'));
        if (it) openVideo(it);
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('img[data-vimeo]'), function (img) {
      fetchVimeoThumb(img.getAttribute('data-vimeo'), function (t) { if (t) img.src = t; });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
