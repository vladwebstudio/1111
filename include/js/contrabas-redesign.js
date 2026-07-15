/* ============================================================
   Contrabas — Redesign UI: хедер, меню, скрол, reveal-анімації,
   лічильники, стрічка клієнтів, форма контактів, hero-відео.
   Vanilla JS, без залежностей.
   ============================================================ */
(function () {
  'use strict';

  var LANG = /eng\.html/i.test(location.pathname) ? 'en' : 'uk';

  /* Той самий Apps Script endpoint, що й у кейсів (форма шле лід туди ж). */
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbwI2_M7eA8jvuwRpk-gCHYi4KhiPCAkrXbkMoSQRXpv5Jtgzsm_BgrTgw2cWHu8DZax/exec';

  var T = {
    uk: {
      sending: 'Надсилаємо…',
      sent: 'Дякуємо! Ми зв’яжемося з вами найближчим часом.',
      err: 'Не вдалося надіслати. Спробуйте ще раз або зателефонуйте нам.',
      needName: 'Вкажіть, будь ласка, ім’я.',
      needContact: 'Залиште email або телефон для звʼязку.'
    },
    en: {
      sending: 'Sending…',
      sent: 'Thank you! We will get back to you shortly.',
      err: 'Could not send. Please try again or give us a call.',
      needName: 'Please enter your name.',
      needContact: 'Leave an email or phone so we can reach you.'
    }
  }[LANG];

  function $(s, c) { return (c || document).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  /* ---------- Стала висота hero (--cx-vh), незалежна від vh/svh/dvh ----------
     У вбудованих браузерах (Telegram in-app тощо) власна «шторка» додатка
     згортається/розгортається під час скролу так само, як адресний рядок у
     Safari/Chrome, і будь-яка динамічна одиниця висоти (vh/svh/dvh) через це
     перераховується в реальному часі — фон hero візуально «стрибає»/масштабується.
     Тому міряємо висоту ОДИН РАЗ через JS і фіксуємо як px — вона більше не
     змінюється під час скролу, лише за СПРАВЖНЬОЇ зміни розміру (обертання
     екрана: тоді і ширина теж змінюється — за цим і відрізняємо від шторки). */
  var _lastVW = window.innerWidth;
  function setHeroVH() {
    document.documentElement.style.setProperty('--cx-vh', window.innerHeight + 'px');
  }
  setHeroVH();
  window.addEventListener('resize', function () {
    if (window.innerWidth !== _lastVW) { _lastVW = window.innerWidth; setHeroVH(); }
  }, { passive: true });
  window.addEventListener('orientationchange', function () {
    setTimeout(setHeroVH, 200);
  });

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    stickyHeader();
    mobileMenu();
    smoothScroll();
    revealOnScroll();
    activeNav();
    counters();
    duplicateMarquee();
    backToTop();
    contactForm();
    leadModal();
    categoryLinks();
    showreelButton();
    heroVideo();
  }

  /* ---------- Липкий хедер ---------- */
  function stickyHeader() {
    var header = $('#cx-header');
    if (!header) return;
    var onScroll = function () {
      if (window.pageYOffset > 40) header.classList.add('is-stuck');
      else header.classList.remove('is-stuck');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Мобільне меню ---------- */
  function mobileMenu() {
    var burger = $('#cx-burger');
    var menu = $('#cx-mobile');
    if (!burger || !menu) return;
    function toggle(open) {
      var willOpen = open === undefined ? !menu.classList.contains('is-open') : open;
      menu.classList.toggle('is-open', willOpen);
      burger.classList.toggle('is-open', willOpen);
      document.body.classList.toggle('no-scroll', willOpen);
      document.body.classList.toggle('cx-menu-open', willOpen);
    }
    burger.addEventListener('click', function () { toggle(); });
    $all('[data-mclose]', menu).forEach(function (a) {
      a.addEventListener('click', function () { toggle(false); });
    });
    // Клік по затемненому фону (поза панеллю) — закрити шухляду.
    menu.addEventListener('click', function (e) { if (e.target === menu) toggle(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) toggle(false);
    });
  }

  /* ---------- Плавний скрол по якорях ---------- */
  function smoothScroll() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href');
      if (id === '#' || id.length < 2) return;
      var target = document.getElementById(id.slice(1));
      if (!target) return;
      e.preventDefault();
      var header = $('#cx-header');
      var offset = header ? header.offsetHeight - 1 : 0;
      var y = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    });
  }

  /* ---------- Reveal-анімації при скролі ---------- */
  function revealOnScroll() {
    var items = $all('.cx-reveal');
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Підсвітка активного пункту меню ---------- */
  function activeNav() {
    var links = $all('.cx-nav a');
    if (!links.length) return;
    var map = {};
    var sections = [];
    links.forEach(function (a) {
      var id = (a.getAttribute('href') || '').slice(1);
      var sec = id && document.getElementById(id);
      if (sec) { map[id] = a; sections.push(sec); }
    });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          links.forEach(function (l) { l.classList.remove('is-active'); });
          var link = map[en.target.id];
          if (link) link.classList.add('is-active');
        }
      });
    }, { threshold: 0.35, rootMargin: '-30% 0px -55% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ---------- Лічильники статистики ---------- */
  function counters() {
    var nums = $all('[data-count]');
    if (!nums.length) return;
    function run(el) {
      var target = parseInt(el.getAttribute('data-count'), 10) || 0;
      var plus = el.querySelector('.plus');
      var suffix = plus ? plus.outerHTML : '';
      var dur = 1400, start = null;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.innerHTML = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    if (!('IntersectionObserver' in window)) { nums.forEach(run); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { run(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.6 });
    nums.forEach(function (n) { io.observe(n); });
  }

  /* ---------- Нескінченна стрічка клієнтів (безшовна) ----------
     Дублюємо самі логотипи В МЕЖАХ ОДНОГО треку. Анімація зсуває трек на -50%
     (рівно на ширину першої копії) → у момент рестарту картинка ідентична,
     тому «стрибка» немає. */
  function duplicateMarquee() {
    var track = $('#cx-clients-track');
    if (!track) return;
    var originals = Array.prototype.slice.call(track.children);
    originals.forEach(function (node) {
      var c = node.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      track.appendChild(c);
    });
    track.classList.add('is-ready');
  }

  /* ---------- Кнопка «нагору» ---------- */
  function backToTop() {
    var btn = $('#cx-top');
    if (!btn) return;
    var onScroll = function () {
      if (window.pageYOffset > 600) btn.classList.add('is-show');
      else btn.classList.remove('is-show');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    onScroll();
  }

  /* ---------- Форми (секція «Контакти» + модалка «Обговорити») ---------- */
  function contactForm() {
    wireForm($('#cx-form'), $('#cx-form-status'));
    wireForm($('#cx-lead-form'), $('#cx-lead-status'), function () {
      // Модалка НЕ закривається сама — показуємо екран «Дякуємо», користувач
      // закриває сам (хрестиком/фоном/Escape/кнопкою «Закрити»).
      showLeadThanks();
    });
  }
  function wireForm(form, status, onSuccess) {
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = (form.elements['name'] && form.elements['name'].value || '').trim();
      var contact = (form.elements['email'] && form.elements['email'].value || '').trim();
      var message = (form.elements['message'] && form.elements['message'].value || '').trim();

      if (!name) { setStatus(T.needName, 'err'); return; }
      if (!contact) { setStatus(T.needContact, 'err'); return; }

      setStatus(T.sending, 'load');
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;

      jsonp({
        action: 'lead', name: name, contact: contact, email: contact,
        message: message, lang: LANG, page: location.href
      }).then(function () {
        if (btn) btn.disabled = false;
        setStatus(T.sent, 'ok'); form.reset();
        if (onSuccess) onSuccess();
      }).catch(function () {
        if (btn) btn.disabled = false;
        setStatus(T.err, 'err');
      });
    });

    function setStatus(msg, type) {
      if (!status) return;
      status.className = 'cx-form__status ' + type;
      status.textContent = msg;
    }
  }

  /* ---------- Модалка «Обговорити проєкт» ---------- */
  var _leadModalEl;
  function leadModal() {
    _leadModalEl = $('#cx-lead');
    if (!_leadModalEl) return;
    $all('[data-open-lead]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); openLead(); });
    });
    _leadModalEl.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-lead-close') || e.target.closest('[data-lead-close]')) closeLead();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _leadModalEl.classList.contains('is-open')) closeLead();
    });
  }
  function openLead() {
    if (!_leadModalEl) return;
    _leadModalEl.classList.add('is-open');
    _leadModalEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    var f = $('#cx-lead-name'); if (f) setTimeout(function () { f.focus(); }, 60);
  }
  function closeLead() {
    if (!_leadModalEl) return;
    _leadModalEl.classList.remove('is-open');
    _leadModalEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    // Скидаємо на форму ЛИШЕ після того, як модалка вже сховалася (transition),
    // щоб користувач не побачив «стрибок» назад на форму під час закриття.
    setTimeout(resetLeadView, 350);
  }
  function showLeadThanks() {
    var formView = $('#cx-lead-form-view');
    var thanksView = $('#cx-lead-thanks-view');
    if (formView) formView.hidden = true;
    if (thanksView) thanksView.hidden = false;
  }
  function resetLeadView() {
    var formView = $('#cx-lead-form-view');
    var thanksView = $('#cx-lead-thanks-view');
    if (thanksView) thanksView.hidden = true;
    if (formView) formView.hidden = false;
    var status = $('#cx-lead-status');
    if (status) { status.textContent = ''; status.className = 'cx-form__status'; }
  }

  /* ---------- Лінки «Що ми робимо» / hero → фільтр портфоліо ---------- */
  function categoryLinks() {
    $all('[data-filter]').forEach(function (el) {
      el.addEventListener('click', function () {
        var cat = el.getAttribute('data-filter');
        // застосовуємо фільтр (скрол на #work робить сам smoothScroll по href="#work")
        function apply() {
          if (window.ContrabasCases && typeof window.ContrabasCases.filter === 'function') {
            window.ContrabasCases.filter(cat);
          }
        }
        // невелика затримка, щоб фільтр застосувався навіть якщо кейси ще будуються
        apply(); setTimeout(apply, 400);
      });
    });
  }

  /* ---------- Кнопка Showreel: відкриває відео у модалці рушія кейсів ---------- */
  function showreelButton() {
    $all('[data-video]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var url = btn.getAttribute('data-video');
        if (!url) return;
        // Використовуємо глобальний хук рушія кейсів, якщо є.
        if (window.ContrabasCases && typeof window.ContrabasCases.playVideo === 'function') {
          e.preventDefault();
          window.ContrabasCases.playVideo(url, {
            name_uk: 'Showreel', name_en: 'Showreel',
            category: 'Reel', year: '', placement: ''
          });
        }
        // інакше — залишаємо звичайний перехід по якорю
      });
    });
  }

  /* ---------- Hero-відео: пауза коли поза екраном (економія ресурсів) ---------- */
  function heroVideo() {
    var v = $('#cx-hero-video');
    if (!v) return;
    // якщо немає <source> — просто ховаємо тег, показуючи постер-картинку
    if (!v.querySelector('source')) { v.style.display = 'none'; return; }
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { v.play && v.play().catch(function () {}); }
        else { v.pause && v.pause(); }
      });
    }, { threshold: 0.05 });
    io.observe(v);
  }

  /* ---------- JSONP (спільний із кейсами формат) ---------- */
  var seq = 0;
  function jsonp(params) {
    return new Promise(function (resolve, reject) {
      var name = '__cx_' + (++seq) + '_' + Date.now();
      var s = document.createElement('script');
      var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, 20000);
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
})();
