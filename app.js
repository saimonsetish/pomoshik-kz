'use strict';

// Mobile navigation is progressive: the form and contact links also work
// without opening a menu. Inert keeps keyboard focus inside the open overlay.
const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.getElementById('main-nav');
if (menuToggle && mainNav) {
  const mobileViewport = matchMedia('(max-width: 850px)');
  const outsideMenu = document.querySelectorAll('main, footer, .mobile-contact, .site-header .brand, .header-info');
  function setMenu(open, returnFocus = false) {
    const expanded = open && mobileViewport.matches;
    document.body.classList.toggle('menu-open', expanded);
    menuToggle.setAttribute('aria-expanded', String(expanded));
    menuToggle.setAttribute('aria-label', expanded ? 'Закрыть меню' : 'Открыть меню');
    outsideMenu.forEach(element => { element.inert = expanded; });
    if (returnFocus) menuToggle.focus();
  }
  menuToggle.hidden = false;
  document.body.classList.add('menu-ready');
  menuToggle.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
  mainNav.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || menuToggle.getAttribute('aria-expanded') !== 'true') return;
    setMenu(false);
    const destination = document.querySelector(link.getAttribute('href'));
    if (destination) {
      destination.setAttribute('tabindex', '-1');
      destination.focus({ preventScroll: true });
    }
  });
  document.addEventListener('keydown', event => {
    if (menuToggle.getAttribute('aria-expanded') !== 'true') return;
    if (event.key === 'Escape') { event.preventDefault(); setMenu(false, true); }
    if (event.key === 'Tab') {
      const first = mainNav.querySelector('a');
      if (!event.shiftKey && document.activeElement === menuToggle) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); menuToggle.focus(); }
    }
  });
  mobileViewport.addEventListener('change', () => setMenu(false));
}

// Existing endpoint. Its source is not in this repository; verify server delivery
// and lawful data handling before publishing. Never put bot credentials here.
const PROXY_URL = 'https://pomoshnik.adilzharas505.workers.dev/';
const CONSENT_VERSION = 'draft-2026-09-30';
const form = document.getElementById('orderForm');
const submitButton = document.getElementById('submitBtn');
const statusBox = document.getElementById('formStatus');
const newOrderButton = document.getElementById('newOrder');
const phoneInput = document.getElementById('phone');
const descriptionInput = document.getElementById('description');
const nameInput = document.getElementById('clientName');
let pending = false;
let accepted = false;

function normalizePhone(value) {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return /^7\d{10}$/.test(digits) ? `+${digits}` : null;
}

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle('error', isError);
  statusBox.hidden = false;
  statusBox.focus();
}

for (const input of [phoneInput, descriptionInput, nameInput]) {
  input.addEventListener('input', () => input.setCustomValidity(''));
}

document.querySelectorAll('[data-category]').forEach(link => {
  link.addEventListener('click', () => {
    document.getElementById('category').value = link.dataset.category;
    updateCategoryNote();
  });
});

function updateCategoryNote() {
  const category = document.getElementById('category');
  const note = document.getElementById('categoryNote');
  note.textContent = `Выбрано: ${category.selectedOptions[0].textContent}`;
  note.hidden = category.value === 'Другое';
}
document.getElementById('category').addEventListener('change', updateCategoryNote);

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending || accepted) return;
  const phone = normalizePhone(phoneInput.value);
  phoneInput.setCustomValidity(phone ? '' : 'Укажите номер с кодом +7: всего 11 цифр. Например, +7 707 123 45 67.');
  descriptionInput.setCustomValidity(descriptionInput.value.trim().length >= 10 ? '' : 'Опишите задачу хотя бы в нескольких словах (от 10 символов).');
  nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Укажите фамилию и имя.');
  if (!form.reportValidity()) return;
  const budget = document.getElementById('budget').value.trim();
  const payload = {
    category: document.getElementById('category').value,
    // Keep the six existing API fields. Include consent information in the
    // description so an unchanged Telegram formatter does not silently omit it.
    description: `${descriptionInput.value.trim()}\n\nКлиент: ${nameInput.value.trim()}\nСогласие: ${CONSENT_VERSION}; отмечено пользователем; время устройства: ${new Date().toISOString()}`,
    address: document.getElementById('address').value.trim() || 'Район уточнить у клиента; точный адрес не запрошен',
    datetime: document.getElementById('datetime').value.trim() || 'Согласовать с клиентом',
    budget: budget || 'Нужна оценка',
    phone
  };
  pending = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Отправляем…';
  form.setAttribute('aria-busy', 'true');
  statusBox.hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
      credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error('Request not accepted');
    accepted = true;
    window.komekAnalytics?.reachGoal('order_received');
    // A 2xx only confirms acceptance by the endpoint, not a master's assignment
    // or delivery by Telegram. Do not promise either at this point.
    showStatus('Сервис приёма принял заявку. Мы свяжемся по указанному номеру, чтобы уточнить детали. Исполнитель пока не назначен. Если нужно уточнить статус, свяжитесь с нами в WhatsApp.');
    newOrderButton.hidden = false;
  } catch (error) {
    showStatus('Не удалось подтвердить приём заявки. Текст сохранён в форме. Возможно, она уже дошла: перед повторной отправкой уточните в WhatsApp.', true);
  } finally {
    clearTimeout(timeout);
    pending = false;
    form.removeAttribute('aria-busy');
    submitButton.disabled = accepted;
    submitButton.textContent = accepted ? 'Заявка принята сервисом' : 'Отправить заявку';
  }
});

newOrderButton.addEventListener('click', () => {
  if (pending) return;
  form.reset();
  updateCategoryNote();
  accepted = false;
  submitButton.disabled = false;
  submitButton.textContent = 'Отправить заявку';
  statusBox.hidden = true;
  newOrderButton.hidden = true;
  for (const input of [phoneInput, descriptionInput, nameInput]) input.setCustomValidity('');
  descriptionInput.focus();
});

// Only enable submission once all handlers are installed. With JavaScript off,
// the browser must not fall back to a GET that puts personal data in the URL.
submitButton.disabled = false;

// The project video is optional. No YouTube request is made until the visitor
// explicitly chooses to watch it; the text explanation works without playback.
const videoButton = document.getElementById('loadVideo');
if (videoButton) {
  videoButton.hidden = false;
  videoButton.addEventListener('click', () => {
    const shell = document.getElementById('videoShell');
    videoButton.disabled = true;
    videoButton.setAttribute('aria-label', 'Загружаем видео');
    videoButton.querySelector('.video-bottom span').textContent = 'Загружаем видео…';
    const player = document.createElement('iframe');
    player.src = 'https://www.youtube-nocookie.com/embed/Wx6eYu65gsY?autoplay=1&rel=0';
    player.title = 'Для чего этот сайт? — видео о komek.kz';
    player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    player.allowFullscreen = true;
    player.className = 'video-loading';
    const timeout = setTimeout(() => {
      // Some browsers or networks block embedded players. Offer a clear route
      // to the original video instead of leaving an empty rectangle forever.
      player.remove();
      const fallback = document.createElement('a');
      fallback.className = 'video-noscript';
      fallback.href = 'https://www.youtube.com/watch?v=Wx6eYu65gsY';
      fallback.target = '_blank';
      fallback.rel = 'noopener noreferrer';
      fallback.textContent = 'Проигрыватель не загрузился. Посмотреть видео на YouTube ↗';
      shell.replaceChildren(fallback);
      fallback.focus();
    }, 8000);
    player.addEventListener('load', () => {
      clearTimeout(timeout);
      videoButton.remove();
      player.classList.remove('video-loading');
      player.focus();
    }, { once: true });
    shell.append(player);
  }, { once: true });
}
