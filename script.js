const heroImage = document.getElementById('heroImage');

const SUB_BACKEND_URL = 'https://rolbuda.vercel.app/api/substitutions';
const NEWS_BACKEND_URL = 'https://rolbuda.vercel.app/api/news';
const PLAN_BACKEND_URL = 'https://rolbuda.vercel.app/api/plan';
const DEPARTURES_BACKEND_URL = 'https://rolbuda.vercel.app/api/departures';

const substitutionsList = document.getElementById('substitutionsList');
const subStatus = document.getElementById('subStatus');
const subMyClass = document.getElementById('subMyClass');
const subCount = document.getElementById('subCount');
const subToggle = document.getElementById('subToggle');
const subDate = document.getElementById('subDate');
const aiSummary = document.getElementById('aiSummary');

const quickPanelMode = document.getElementById('quickPanelMode');
const quickContent = document.getElementById('quickContent');

const USER_CLASS_KEY = 'pzs2_user_class';
const EXTRA_SUB_CLASSES_KEY = 'pzs2_extra_sub_classes';

const newsContainer = document.querySelector('.announcement-list');
const newsToggle = document.getElementById('newsToggle');
const announcementList = document.querySelector('.announcement-list');

const planStatus = document.getElementById('planStatus');
const classSearch = document.getElementById('classSearch');
const classList = document.getElementById('classList');
const planPreview = document.getElementById('planPreview');

const themeToggle = document.getElementById('themeToggle');
const THEME_KEY = 'pzs2_theme';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

let SUB_DATA = { general: [], teachers: [], rawText: '' };
let SUB_FILTER_OPEN = false;
let SUB_SHOW_ALL_ENTRIES = false;
let EXTRA_SUB_CLASSES = new Set(loadExtraSubClasses());

let CURRENT_GROUP = localStorage.getItem('group') || 'all';
let CURRENT_PLAN_DATA = null;
let CURRENT_CLASS_NAME = '';

let CLASSES = [];
let lastScroll = 0;

const DEPARTURES_CACHE_KEY = 'pzs2_departures_cache';
let DEPARTURES_DATA = null;
let DEPARTURES_OFFLINE = false;
let BUS_SHOW_ALL = false;
let ACTIVE_QUICK_MODE = 'buses';
let ACTIVE_BUS_STOP = 0;

/* =========================
   OGÓLNE HELPERY
========================= */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSavedClass() {
  try {
    return JSON.parse(localStorage.getItem(USER_CLASS_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveClass(cls) {
  localStorage.setItem(USER_CLASS_KEY, JSON.stringify(cls));
}

function normalizeCell(cell) {
  if (cell == null) return [];

  if (Array.isArray(cell)) {
    return cell
      .map(v => String(v).trim())
      .filter(Boolean);
  }

  const text = String(cell).trim();

  if (!text) return [];

  return text
    .split(/\n+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function renderCell(cell) {
  const lines = normalizeCell(cell);

  if (!lines.length) {
    return '<div class="empty-cell"></div>';
  }

  const filtered = lines.filter(line => {
    const lower = line.toLowerCase();

    if (!lower.includes('1/2') && !lower.includes('2/2')) {
      return true;
    }

    if (CURRENT_GROUP === 'all') return true;
    if (CURRENT_GROUP === '1' && lower.includes('1/2')) return true;
    if (CURRENT_GROUP === '2' && lower.includes('2/2')) return true;

    return false;
  });

  if (!filtered.length) {
    return '<div class="empty-cell"></div>';
  }

  return filtered
    .map(line => `<div class="lesson-line">${escapeHtml(line)}</div>`)
    .join('');
}


/* =========================
   KRÓTKI SKRÓT / BUSY
========================= */

function getDepartureLimit() {
  return window.matchMedia('(max-width: 720px)').matches ? 3 : 5;
}

function saveDeparturesCache(data) {
  try {
    localStorage.setItem(DEPARTURES_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  } catch {
    // localStorage może być pełny albo niedostępny — wtedy po prostu nie zapisujemy fallbacku.
  }
}

function loadDeparturesCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(DEPARTURES_CACHE_KEY) || 'null');
    return cached?.data ? cached : null;
  } catch {
    return null;
  }
}

function formatDataTime(timestamp) {
  if (!timestamp) return '';

  const date = new Date(Number(timestamp) * 1000);

  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getDepartureMeta(dep) {
  const meta = [];

  if (dep.platform) meta.push(`stanowisko ${dep.platform}`);
  if (dep.estimated) meta.push('na żywo');
  else meta.push('rozkład');
  if (dep.delayMinutes > 0) meta.push(`+${dep.delayMinutes} min`);
  if (dep.delayMinutes < 0) meta.push(`${dep.delayMinutes} min`);

  return meta.join(' · ');
}

function renderDepartureRow(dep) {
  const cancelled = dep.canceled ? ' cancelled' : '';
  const direction = dep.direction || 'Kierunek niepodany';
  const meta = getDepartureMeta(dep);
  const timeNote = dep.canceled
    ? 'odwołany'
    : (dep.scheduledTime && dep.scheduledTime !== dep.time ? `planowo ${dep.scheduledTime}` : '');

  return `
    <article class="bus-row${cancelled}">
      <div class="bus-line">${escapeHtml(dep.line)}</div>
      <div class="bus-main">
        <div class="bus-direction">${escapeHtml(direction)}</div>
        <div class="bus-meta">${escapeHtml(meta)}</div>
      </div>
      <div class="bus-time">
        ${escapeHtml(dep.time)}
        ${timeNote ? `<small>${escapeHtml(timeNote)}</small>` : ''}
      </div>
    </article>
  `;
}

function renderBusStop(stop, limit) {
  const departures = Array.isArray(stop.departures) ? stop.departures : [];
  const visible = BUS_SHOW_ALL ? departures : departures.slice(0, limit);
  const platform = stop.platform ? ` · stanowisko ${stop.platform}` : '';

  return `
    <section class="bus-stop">
      <div class="bus-stop-head">
        <div class="bus-stop-title">
          <strong>${escapeHtml(stop.label || 'Przystanek')}</strong>
          <span>${escapeHtml(stop.stationName || 'Pszczyna ul. Szymanowskiego')}${escapeHtml(platform)}</span>
        </div>
        <span class="bus-updated">${departures.length} odj.</span>
      </div>

      <div class="bus-list">
        ${visible.length
          ? visible.map(renderDepartureRow).join('')
          : `<div class="quick-empty" style="padding:14px;">Brak najbliższych odjazdów.</div>`
        }
      </div>
    </section>
  `;
}

function renderBuses() {
  if (!quickContent) return;

  if (!DEPARTURES_DATA?.stops?.length) {
    quickContent.innerHTML = `
      <div class="quick-empty">
        Nie udało się wczytać odjazdów. Po pierwszym poprawnym wczytaniu aplikacja pokaże tu ostatnio zapisane dane offline.
      </div>
    `;
    return;
  }

  const limit = getDepartureLimit();
  const stops = DEPARTURES_DATA.stops;
  const stopIndex = clamp(ACTIVE_BUS_STOP, 0, stops.length - 1);
  const activeStop = stops[stopIndex];
  const departures = activeStop?.departures || [];
  const hasMore = departures.length > limit;
  const updatedAt = formatDataTime(DEPARTURES_DATA.updatedAt);

  renderBusStopTabs(stops, stopIndex);

  quickContent.innerHTML = `
    <div class="bus-widget">
      ${DEPARTURES_OFFLINE ? `
        <div class="bus-offline-note">
          Tryb offline — pokazuję ostatnio zapisane odjazdy. Godziny mogą być już nieaktualne.
        </div>
      ` : ''}

      ${renderBusStop(activeStop, limit)}

      ${updatedAt ? `<div class="quick-note">Aktualizacja danych: ${escapeHtml(updatedAt)}</div>` : ''}

      ${hasMore ? `
        <div class="bus-more-wrap">
          <button id="busMoreToggle" class="bus-more-button" type="button">
            ${BUS_SHOW_ALL ? 'Pokaż mniej' : 'Pokaż więcej'}
          </button>
        </div>
      ` : ''}
    </div>
  `;

  const toggle = document.getElementById('busMoreToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      BUS_SHOW_ALL = !BUS_SHOW_ALL;
      renderBuses();
    });
  }
}

function renderTeachersQuickInfo() {
  if (!quickContent) return;

  quickContent.innerHTML = `
    <div class="quick-note">
      Tu można później dodać szybkie informacje dla nauczycieli, np. dyżury, link do dziennika, sale lub ważne komunikaty.
    </div>
  `;
}

function renderBusStopTabs(stops = [], activeIndex = ACTIVE_BUS_STOP) {
  document.querySelectorAll('[data-bus-stop]').forEach((btn, index) => {
    const stopIndex = Number(btn.dataset.busStop || index);
    const stop = stops[stopIndex];
    const isActive = stopIndex === activeIndex;

    btn.hidden = !stop;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function renderQuickPanel() {
  if (quickPanelMode) quickPanelMode.value = ACTIVE_QUICK_MODE;

  const stopTabs = document.querySelector('.quick-tabs');
  if (stopTabs) stopTabs.hidden = ACTIVE_QUICK_MODE !== 'buses';

  if (ACTIVE_QUICK_MODE === 'teachers') {
    renderTeachersQuickInfo();
    return;
  }

  renderBuses();
}

function bindQuickControls() {
  if (quickPanelMode) {
    quickPanelMode.addEventListener('change', () => {
      ACTIVE_QUICK_MODE = quickPanelMode.value || 'buses';
      BUS_SHOW_ALL = false;
      renderQuickPanel();
    });
  }

  document.querySelectorAll('[data-bus-stop]').forEach(btn => {
    btn.addEventListener('click', () => {
      ACTIVE_BUS_STOP = Number(btn.dataset.busStop || 0);
      BUS_SHOW_ALL = false;
      renderQuickPanel();
    });
  });
}

async function loadDepartures({ silent = false } = {}) {
  if (!quickContent) return;

  if (!silent && quickContent) {
    quickContent.innerHTML = '<div class="quick-loading">Ładowanie aktualnych odjazdów...</div>';
  }

  try {
    const res = await fetch(DEPARTURES_BACKEND_URL, {
      cache: 'no-store'
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    DEPARTURES_DATA = data;
    DEPARTURES_OFFLINE = false;
    saveDeparturesCache(data);
    renderQuickPanel();
  } catch (err) {
    console.error('Błąd odjazdów:', err);

    const cached = loadDeparturesCache();

    if (cached?.data) {
      DEPARTURES_DATA = cached.data;
      DEPARTURES_OFFLINE = true;
      renderQuickPanel();
      return;
    }

    renderBuses();
  }
}

/* =========================
   ZASTĘPSTWA
========================= */

function loadExtraSubClasses() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXTRA_SUB_CLASSES_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveExtraSubClasses() {
  localStorage.setItem(EXTRA_SUB_CLASSES_KEY, JSON.stringify([...EXTRA_SUB_CLASSES]));
}

function normalizeClassName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function extractClassesFromText(text) {
  const value = String(text || '');

  const matches = [...value.matchAll(
    /\b([1-5])\s*(LO[a-d]|T[a-ząćęłńóśźż]{1,3}|BS[a-d]?|Bs[a-d]?)\b/gi
  )];

  return matches.map(match => {
    return `${match[1]}${match[2]}`.replace(/\s+/g, '');
  });
}

function getEntryClasses(entry) {
  const classes = Array.isArray(entry?.classes) ? entry.classes : [];

  return [
    ...classes,
    entry?.className,
    ...extractClassesFromText(entry?.raw),
    ...extractClassesFromText(entry?.summary)
  ].filter(Boolean);
}

function entryHasMine(entry, saved) {
  if (!saved?.name || !entry) return false;

  const savedName = normalizeClassName(saved.name);

  return getEntryClasses(entry).some(cls => {
    return normalizeClassName(cls) === savedName;
  });
}

function isTeacherLine(text) {
  const value = String(text || '').trim();

  if (!value) return false;
  if (/lek\.?/i.test(value)) return false;
  if (/nauczyciele|praktyki|egzamin|elektronicznym|zmiany|korekty/i.test(value)) return false;
  if (value.length > 60) return false;

  return /^[A-ZŁŚŻŹĆŃÓĘ]\.?\s*[A-ZŁŚŻŹĆŃÓĘ][a-ząćęłńóśźż-]+(?:\s*[–-]\s*[A-ZŁŚŻŹĆŃÓĘ][a-ząćęłńóśźż-]+)?$/u.test(value);
}

function normalizeSubType(entry) {
  const raw = String(entry?.raw || entry?.summary || '').toLowerCase();

  if (
    raw.includes('zwolnienie') ||
    raw.includes('zwolniona') ||
    raw.includes('zwolniony')
  ) {
    return 'cancelled';
  }

  if (
    raw.includes('przeniesienie') ||
    raw.includes('przeniesiona') ||
    raw.includes('przeniesie') ||
    raw.includes(' z lek')
  ) {
    return 'moved';
  }

  return entry?.type === 'info' ? 'substitution' : (entry?.type || 'substitution');
}

function normalizeSubEntry(entry, teacher = null) {
  const classes = getEntryClasses(entry);
  const raw = entry?.raw || entry?.summary || '';

  return {
    ...entry,
    teacher: entry?.teacher || teacher,
    classes,
    className: classes[0] || entry?.className || null,
    type: normalizeSubType(entry),
    summary: raw
  };
}

function buildTeacherGroupsFromGeneral(general) {
  const groups = [];
  let currentGroup = null;

  general.forEach(entry => {
    const raw = String(entry?.raw || entry?.summary || '').trim();

    if (!raw) return;

    if (isTeacherLine(raw)) {
      currentGroup = {
        teacher: raw,
        entries: []
      };

      groups.push(currentGroup);
      return;
    }

    if (!currentGroup) return;

    const looksLikeLesson =
      (/lek\.?/i.test(raw) && extractClassesFromText(raw).length) ||
      /lek\.?\s*\d/i.test(raw) ||
      /^lek\s*\d/i.test(raw) ||
      /\bzwolnienie\b/i.test(raw) ||
      /\bbiblioteka\b/i.test(raw) ||
      /\bprzenies/i.test(raw);

    if (!looksLikeLesson) return;

    currentGroup.entries.push(normalizeSubEntry(entry, currentGroup.teacher));
  });

  return groups.filter(group => group.entries.length);
}

function getTeacherGroups(data) {
  const general = Array.isArray(data?.general) ? data.general : [];

  const teachers = Array.isArray(data?.teachers) && data.teachers.length
    ? data.teachers
    : buildTeacherGroupsFromGeneral(general);

  return teachers.map(group => ({
    teacher: group.teacher || '—',
    entries: (group.entries || []).map(entry => normalizeSubEntry(entry, group.teacher))
  }));
}

function getAllNormalizedEntries(data) {
  return getTeacherGroups(data).flatMap(group => group.entries);
}

function normalizeDedupText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
}

function getMainClassKey(entry) {
  const classes = getEntryClasses(entry);

  if (!classes.length) return '';

  return normalizeClassName(classes[0]);
}

function getEntryDedupKey(entry) {
  const type = normalizeSubType(entry);
  const cls = getMainClassKey(entry);

  const lessons = Array.isArray(entry.lessons)
    ? [...new Set(entry.lessons)]
      .map(Number)
      .filter(n => !Number.isNaN(n))
      .sort((a, b) => a - b)
      .join(',')
    : '';

  if (type === 'cancelled') {
    return `${type}|${cls}|${lessons}`;
  }

  const text = normalizeDedupText(entry.raw || entry.summary || '');

  return `${type}|${cls}|${lessons}|${text}`;
}

function uniqueEntries(entries) {
  const seen = new Set();

  return entries.filter(entry => {
    const key = getEntryDedupKey(entry);

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function sortClassNames(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');

  const gradeA = parseInt(aa.match(/\d+/)?.[0] || '99', 10);
  const gradeB = parseInt(bb.match(/\d+/)?.[0] || '99', 10);

  if (gradeA !== gradeB) return gradeA - gradeB;

  return aa.localeCompare(bb, 'pl');
}

function getClassesWithSubstitutions(data) {
  const map = new Map();

  uniqueEntries(getAllNormalizedEntries(data)).forEach(entry => {
    const type = normalizeSubType(entry);

    if (!['cancelled', 'moved', 'substitution'].includes(type)) return;

    getEntryClasses(entry).forEach(cls => {
      const key = normalizeClassName(cls);

      if (!key) return;

      if (!map.has(key)) {
        map.set(key, {
          key,
          name: String(cls).replace(/\s+/g, '')
        });
      }
    });
  });

  return [...map.values()].sort((a, b) => sortClassNames(a.name, b.name));
}

function getSelectedSubClasses(saved, availableClasses) {
  const availableKeys = new Set(availableClasses.map(c => c.key));
  const selected = [];

  if (saved?.name) {
    const savedKey = normalizeClassName(saved.name);

    selected.push({
      key: savedKey,
      name: saved.name,
      isMain: true
    });
  }

  EXTRA_SUB_CLASSES = new Set(
    [...EXTRA_SUB_CLASSES].filter(key => {
      if (!availableKeys.has(key)) return false;
      if (saved?.name && key === normalizeClassName(saved.name)) return false;
      return true;
    })
  );

  saveExtraSubClasses();

  EXTRA_SUB_CLASSES.forEach(key => {
    const found = availableClasses.find(c => c.key === key);

    if (found) {
      selected.push({
        ...found,
        isMain: false
      });
    }
  });

  return selected;
}

function collectEntriesForSelectedClasses(data, selectedClasses) {
  const selectedKeys = new Set(selectedClasses.map(c => c.key));

  if (!selectedKeys.size) return [];

  const entries = uniqueEntries(getAllNormalizedEntries(data));

  return entries.filter(entry => {
    return getEntryClasses(entry).some(cls => {
      return selectedKeys.has(normalizeClassName(cls));
    });
  });
}

function collectPersonalEntries(data, saved) {
  if (!saved?.name) return [];

  const selected = [{
    key: normalizeClassName(saved.name),
    name: saved.name,
    isMain: true
  }];

  return collectEntriesForSelectedClasses(data, selected);
}

function renderSubClassFilter(availableClasses, selectedClasses, saved) {
  const selectedKeys = new Set(selectedClasses.map(c => c.key));
  const savedKey = saved?.name ? normalizeClassName(saved.name) : '';

  return `
    <div class="sub-class-filter">
      <div class="sub-class-dropdown open">
        <div class="sub-class-dropdown-head">
          Klasy z dzisiejszymi zmianami
        </div>

        <div class="sub-class-options">
          ${availableClasses.length
            ? availableClasses.map(cls => {
                const isMain = cls.key === savedKey;
                const checked = selectedKeys.has(cls.key);

                return `
                  <label class="sub-class-option ${isMain ? 'main' : ''}">
                    <input
                      type="checkbox"
                      value="${escapeHtml(cls.key)}"
                      ${checked ? 'checked' : ''}
                      ${isMain ? 'disabled' : ''}
                    />
                    <span>${escapeHtml(cls.name)}${isMain ? ' · Twoja klasa' : ''}</span>
                  </label>
                `;
              }).join('')
            : `<div class="sub-empty">Brak klas z zastępstwami.</div>`
          }
        </div>
      </div>
    </div>
  `;
}

function bindSubClassFilterEvents() {
  document.querySelectorAll('.sub-class-option input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.value;

      if (input.checked) {
        EXTRA_SUB_CLASSES.add(key);
      } else {
        EXTRA_SUB_CLASSES.delete(key);
      }

      SUB_SHOW_ALL_ENTRIES = false;

      saveExtraSubClasses();
      renderSubstitutions(SUB_DATA);

      if (aiSummary) {
        aiSummary.textContent = buildSummary(SUB_DATA, getSavedClass());
      }
    });
  });
}

function bindSubEntriesToggle() {
  const btn = document.getElementById('subEntriesToggle');

  if (!btn) return;

  btn.addEventListener('click', () => {
    SUB_SHOW_ALL_ENTRIES = !SUB_SHOW_ALL_ENTRIES;
    renderSubstitutions(SUB_DATA);
  });
}

function formatLessonRange(lessons) {
  if (!Array.isArray(lessons) || !lessons.length) return 'nieznana lekcja';

  const sorted = [...new Set(lessons)]
    .map(Number)
    .filter(n => !Number.isNaN(n))
    .sort((a, b) => a - b);

  if (!sorted.length) return 'nieznana lekcja';

  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];

    if (n === prev + 1) {
      prev = n;
      continue;
    }

    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }

  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);

  return `lek. ${ranges.join(', ')}`;
}

function typeLabel(type) {
  if (type === 'cancelled') return 'Odwołane';
  if (type === 'moved') return 'Przeniesione';
  return 'Zastępstwo';
}

function typeClass(type) {
  if (type === 'cancelled') return 'cancelled';
  if (type === 'moved') return 'moved';
  if (type === 'substitution') return 'substitution';
  return '';
}

function changeWord(n) {
  if (n === 1) return 'zmianę';
  return 'zmiany';
}

function teacherWord(n) {
  if (n === 1) return 'nauczyciel';
  return 'nauczycieli';
}

function buildSummary(data, saved) {
  if (!saved?.name) {
    return 'Wybierz klasę — wtedy zrobię analizę specjalnie dla Ciebie.';
  }

  const availableClasses = getClassesWithSubstitutions(data);
  const selectedClasses = getSelectedSubClasses(saved, availableClasses);
  const entries = collectEntriesForSelectedClasses(data, selectedClasses);

  const teacherGroups = getTeacherGroups(data);
  const absentTeachers = [...new Set(teacherGroups.map(g => g.teacher).filter(Boolean))];

  if (!entries.length) {
    return `Stety lub niestety dla ${saved.name} — brak zastępstw, współczuję.`;
  }

  const cancelled = entries.filter(e => e.type === 'cancelled').length;
  const moved = entries.filter(e => e.type === 'moved').length;

  if (cancelled >= 3) {
    return `🔥 Dużo odwołań (${cancelled}) — możliwe luzy dla wybranych klas`;
  }

  if (moved >= 3) {
    return `⚠️ Sporo zmian sal/godzin — uważaj na plan`;
  }

  return `${entries.length} zmian · ${absentTeachers.length} nauczycieli nieobecnych`;
}

function summarizePersonal(entries) {
  const cancelled = entries.filter(e => e.type === 'cancelled');
  const moved = entries.filter(e => e.type === 'moved');
  const substitution = entries.filter(e => e.type === 'substitution');

  const cancelledLessons = cancelled.flatMap(e => e.lessons?.length ? e.lessons : []);
  const movedLessons = moved.flatMap(e => e.lessons?.length ? e.lessons : []);
  const substitutionLessons = substitution.flatMap(e => e.lessons?.length ? e.lessons : []);

  return {
    total: entries.length,
    cancelledCount: cancelled.length,
    movedCount: moved.length,
    substitutionCount: substitution.length,
    cancelledLessons: formatLessonRange(cancelledLessons),
    movedLessons: formatLessonRange(movedLessons),
    substitutionLessons: formatLessonRange(substitutionLessons),
  };
}

function renderPersonalCard(entries, saved, selectedClasses = []) {
  const stats = summarizePersonal(entries);

  const visibleLimit = 5;
  const shouldCollapse = entries.length > visibleLimit;
  const visibleItems = SUB_SHOW_ALL_ENTRIES ? entries : entries.slice(0, visibleLimit);

  const selectedNames = selectedClasses.map(c => c.name);
  const isOnlyMine = selectedClasses.length <= 1;

  const title = isOnlyMine
    ? `Twoja klasa · ${saved?.name || '—'}`
    : `Wybrane klasy · ${selectedNames.join(', ')}`;

  return `
    <article class="sub-summary-card ${entries.some(e => e.type === 'cancelled') ? 'sub-card--mine' : ''}">
      <div class="sub-top">
        <div class="sub-teacher">${escapeHtml(title)}</div>
        <div class="sub-type ${stats.cancelledCount ? 'cancelled' : ''}">
          ${stats.total ? 'dzisiaj' : 'brak zmian'}
        </div>
      </div>

      <div class="sub-line">
        ${stats.total
          ? `${isOnlyMine ? 'Masz' : 'Znaleziono'} ${stats.total} ${changeWord(stats.total)}.`
          : 'Brak zmian dla wybranych klas.'
        }
      </div>

      <div class="sub-meta">
        ${stats.cancelledCount ? `<span class="sub-chip mine">${escapeHtml(stats.cancelledLessons)}</span>` : ''}
        ${stats.movedCount ? `<span class="sub-chip">${escapeHtml(stats.movedLessons)}</span>` : ''}
        ${stats.substitutionCount ? `<span class="sub-chip">${escapeHtml(stats.substitutionLessons)}</span>` : ''}
      </div>

      <div class="sub-mini-list">
        ${visibleItems.length
          ? visibleItems.map(item => `
              <div class="sub-mini-item ${item.type === 'cancelled' ? 'sub-card--cancelled' : ''} ${item.type === 'moved' ? 'sub-card--moved' : ''} ${item.type === 'substitution' ? 'sub-card--substitution' : ''}">
                <div class="sub-mini-head">
                  <div class="sub-mini-title">
                    ${escapeHtml(item.className || (item.classes && item.classes[0]) || '—')}
                    · ${escapeHtml(formatLessonRange(item.lessons))}
                  </div>
                  <div class="sub-type ${typeClass(item.type)}">${typeLabel(item.type)}</div>
                </div>
                <div class="sub-line">${escapeHtml(item.summary || item.raw || '')}</div>
              </div>
            `).join('')
          : `<div class="sub-empty">Brak szczegółów dla wybranych klas.</div>`
        }
      </div>

      ${shouldCollapse
        ? `
          <button id="subEntriesToggle" class="sub-more-button" type="button">
            ${SUB_SHOW_ALL_ENTRIES
              ? 'Pokaż mniej'
              : `Pokaż wszystkie zmiany (+${entries.length - visibleLimit})`
            }
          </button>
        `
        : ''
      }
    </article>
  `;
}

function renderSubstitutions(data) {
  if (!substitutionsList) return;

  const saved = getSavedClass();

  const availableClasses = getClassesWithSubstitutions(data);
  const selectedClasses = getSelectedSubClasses(saved, availableClasses);
  const selectedEntries = collectEntriesForSelectedClasses(data, selectedClasses);

  const teacherGroups = getTeacherGroups(data);
  const absentTeachers = [...new Set(teacherGroups.map(g => g.teacher).filter(Boolean))];

  if (subDate) {
    subDate.textContent =
      data.dateLabel ||
      data.general?.[0]?.raw ||
      data.general?.[0]?.summary ||
      'Zastępstwa';
  }

  if (subMyClass) {
    subMyClass.textContent = saved?.name || '—';
  }

  if (subCount) {
    subCount.textContent =
      `${selectedEntries.length} ${changeWord(selectedEntries.length)} · ${absentTeachers.length} ${teacherWord(absentTeachers.length)}`;
  }

  substitutionsList.innerHTML = `
    <div class="sub-summary-grid">
      ${renderPersonalCard(selectedEntries, saved, selectedClasses)}

      <article class="sub-summary-card">
        <div class="sub-top">
          <div class="sub-teacher">Nieobecni nauczyciele</div>
          <div class="sub-type info">${absentTeachers.length} ${teacherWord(absentTeachers.length)}</div>
        </div>

        <div class="sub-line">
          ${absentTeachers.length
            ? escapeHtml(absentTeachers.join(', '))
            : 'Brak danych o nieobecnych nauczycielach.'
          }
        </div>
      </article>
    </div>

    ${SUB_FILTER_OPEN
      ? renderSubClassFilter(availableClasses, selectedClasses, saved)
      : ''
    }
  `;

  bindSubClassFilterEvents();
  bindSubEntriesToggle();

  if (subToggle) {
    const extraCount = selectedClasses.filter(c => !c.isMain).length;

    subToggle.textContent = extraCount
      ? `Dodaj inne klasy (${extraCount})`
      : 'Dodaj inne klasy';

    subToggle.style.display = availableClasses.length ? 'inline-flex' : 'none';
  }
}

async function loadSubstitutions() {
  try {
    if (subStatus) subStatus.textContent = 'Ładowanie...';

    const res = await fetch(SUB_BACKEND_URL, { cache: 'no-store' });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    SUB_DATA = {
      ...data,
      general: Array.isArray(data.general) ? data.general : [],
      teachers: Array.isArray(data.teachers) ? data.teachers : [],
      rawText: data.rawText || ''
    };

    SUB_FILTER_OPEN = false;
    SUB_SHOW_ALL_ENTRIES = false;

    renderSubstitutions(SUB_DATA);

    if (aiSummary) {
      aiSummary.textContent = buildSummary(SUB_DATA, getSavedClass());
    }

    if (subStatus) subStatus.textContent = 'Gotowe';
  } catch (e) {
    console.error('Błąd zastępstw:', e);

    if (subStatus) subStatus.textContent = 'Błąd';

    if (aiSummary) {
      aiSummary.textContent = 'Nie udało się pobrać zastępstw.';
    }

    if (substitutionsList) {
      substitutionsList.innerHTML = `<div class="sub-empty">Nie udało się pobrać zastępstw.</div>`;
    }
  }
}

/* =========================
   AKTUALNOŚCI
========================= */

if (newsToggle && announcementList) {
  newsToggle.addEventListener('click', () => {
    announcementList.classList.toggle('expanded');

    const expanded = announcementList.classList.contains('expanded');
    newsToggle.textContent = expanded ? 'Pokaż mniej' : 'Pokaż więcej';
  });
}

async function loadNews() {
  try {
    if (!newsContainer) return;

    const res = await fetch(NEWS_BACKEND_URL, { cache: 'no-store' });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      newsContainer.innerHTML = `
        <article class="announcement">
          <div class="date-pill">--<br/>----</div>
          <div>
            <strong>Brak aktualności</strong>
            <p>Nie udało się pobrać nowości ze strony szkoły.</p>
          </div>
          <div class="chip">info</div>
        </article>
      `;
      return;
    }

    newsContainer.innerHTML = '';

    data.slice(0, 5).forEach(item => {
      const el = document.createElement('article');
      el.className = 'announcement';

      el.innerHTML = `
        <div class="date-pill">Aktualne<br/>2026</div>
        <div>
          <strong>${escapeHtml(item.title || '')}</strong>
          <p>${escapeHtml(item.desc || '')}</p>
        </div>
        <div class="chip">info</div>
      `;

      newsContainer.appendChild(el);
    });
  } catch (e) {
    console.error('Błąd news:', e);
  }
}

/* =========================
   KLASY I PLAN LEKCJI
========================= */

async function loadClasses() {
  try {
    const res = await fetch('https://rolbuda.vercel.app/api/classes', {
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      CLASSES = [];
      renderClassButtons(CLASSES);

      if (planStatus) planStatus.textContent = 'Brak klas';

      return;
    }

    CLASSES = data;
    renderClassButtons(CLASSES);

    const saved = getSavedClass();

    if (saved) {
      loadPlan(saved.id, saved.name);

      if (planStatus) {
        planStatus.textContent = `Twoja klasa: ${saved.name}`;
      }
    } else {
      showClassModal(CLASSES);

      if (planStatus) {
        planStatus.textContent = 'Wybierz klasę';
      }
    }
  } catch (e) {
    console.error('Błąd klas:', e);

    if (planStatus) {
      planStatus.textContent = 'Błąd klas';
    }
  }
}

function renderClassButtons(list) {
  if (!classList) return;

  classList.innerHTML = `
    <select id="classSelect" style="
      width:100%;
      padding:14px 16px;
      border-radius:16px;
      border:1px solid rgba(16,32,51,.12);
      background:#fff;
    ">
      <option value="">Wybierz klasę.</option>
      ${list.map(c => `
        <option value="${escapeHtml(c.id)}">
          ${escapeHtml(c.name)}
        </option>
      `).join('')}
    </select>
  `;

  const select = document.getElementById('classSelect');

  select.addEventListener('change', () => {
    const selected = list.find(c => c.id === select.value);

    if (selected) {
      saveClass(selected);
      loadPlan(selected.id, selected.name);

      EXTRA_SUB_CLASSES = new Set();
      SUB_FILTER_OPEN = false;
      SUB_SHOW_ALL_ENTRIES = false;

      saveExtraSubClasses();

      if (aiSummary) {
        aiSummary.textContent = buildSummary(SUB_DATA, selected);
      }

      renderSubstitutions(SUB_DATA);
    }
  });
}

function isNoiseRow(row) {
  const text = row
    .flatMap(cell => normalizeCell(cell))
    .join(' ')
    .toLowerCase();

  return (
    text.includes('drukuj') ||
    text.includes('wygenerowano') ||
    text.includes('plan lekcji') ||
    text.includes('obowiązuje od')
  );
}

function renderPlan() {
  const data = CURRENT_PLAN_DATA;
  const className = CURRENT_CLASS_NAME;

  if (!planPreview) return;

  if (!data || !Array.isArray(data.rows) || !data.rows.length) {
    planPreview.innerHTML = `<p>Brak danych planu.</p>`;
    return;
  }

  const rows = data.rows.filter(row => {
    return Array.isArray(row) && row.length && !isNoiseRow(row);
  });

  if (!rows.length) {
    planPreview.innerHTML = `<p>Brak danych planu.</p>`;
    return;
  }

  const header = rows[0];
  const bodyRows = rows.slice(1);

  planPreview.innerHTML = `
    <div style="margin-bottom:12px; color:var(--muted);">
      <strong>${escapeHtml(className)}</strong>
      ${data.validFrom ? ` · obowiązuje od: ${escapeHtml(data.validFrom)}` : ''}
      ${data.generatedAt ? ` · wygenerowano: ${escapeHtml(data.generatedAt)}` : ''}
    </div>

    <div style="margin-bottom:12px;">
      <select id="groupSelect" style="
        width:100%;
        padding:14px 16px;
        border-radius:16px;
        border:1px solid rgba(16,32,51,.12);
        background:#fff;
      ">
        <option value="all">Cała klasa</option>
        <option value="1">Grupa 1</option>
        <option value="2">Grupa 2</option>
      </select>
    </div>

    <div class="timetable">
      <div class="timetable-row timetable-head">
        ${header.map(cell => `<div>${renderCell(cell)}</div>`).join('')}
      </div>

      ${bodyRows.map(row => `
        <div class="timetable-row">
          ${row.map(cell => `<div>${renderCell(cell)}</div>`).join('')}
        </div>
      `).join('')}
    </div>
  `;

  const groupSelect = document.getElementById('groupSelect');

  if (groupSelect) {
    groupSelect.value = CURRENT_GROUP;

    groupSelect.addEventListener('change', () => {
      CURRENT_GROUP = groupSelect.value;
      localStorage.setItem('group', CURRENT_GROUP);
      renderPlan();
    });
  }
}

async function loadPlan(classId, className) {
  try {
    if (planStatus) {
      planStatus.textContent = `Ładowanie: ${className}.`;
    }

    const res = await fetch(`${PLAN_BACKEND_URL}?class=${encodeURIComponent(classId)}`, {
      cache: 'no-store'
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    CURRENT_PLAN_DATA = data;
    CURRENT_CLASS_NAME = className;

    renderPlan();

    if (planStatus) {
      planStatus.textContent = `Wczytano: ${className}`;
    }
  } catch (e) {
    console.error(e);

    if (planStatus) {
      planStatus.textContent = 'Błąd planu';
    }
  }
}

function showClassModal(classes) {
  const modal = document.getElementById('classModal');
  const select = document.getElementById('modalClassSelect');
  const confirm = document.getElementById('modalConfirm');

  if (!modal || !select || !confirm) return;

  select.innerHTML = `
    <option value="">Wybierz klasę.</option>
    ${classes.map(c => `
      <option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>
    `).join('')}
  `;

  modal.classList.remove('hidden');

  confirm.onclick = () => {
    const selected = classes.find(c => c.id === select.value);

    if (!selected) return;

    saveClass(selected);

    modal.classList.add('hidden');

    loadPlan(selected.id, selected.name);

    EXTRA_SUB_CLASSES = new Set();
    SUB_FILTER_OPEN = false;
    SUB_SHOW_ALL_ENTRIES = false;

    saveExtraSubClasses();

    if (aiSummary) {
      aiSummary.textContent = buildSummary(SUB_DATA, selected);
    }

    renderSubstitutions(SUB_DATA);
  };
}

/* =========================
   SCROLL / HERO
========================= */

window.addEventListener('scroll', () => {
  if (window.innerWidth > 767) return;

  const currentScroll = window.pageYOffset;
  const header = document.querySelector('.topbar');

  if (!header) return;

  if (currentScroll > lastScroll && currentScroll > 100) {
    header.classList.add('topbar--hidden');
  } else {
    header.classList.remove('topbar--hidden');
  }

  lastScroll = currentScroll;
});

function onScroll() {
  const y = window.scrollY || 0;
  const fade = clamp(1 - y / 520, 0.18, 1);
  const scale = clamp(1 - y / 6000, 0.94, 1);
  const blur = clamp(y / 650, 0, 3.2);

  if (heroImage) {
    heroImage.style.opacity = fade.toFixed(3);
    heroImage.style.transform = `scale(${scale}) translateY(${Math.min(y * 0.08, 28)}px)`;
    heroImage.style.filter = `saturate(1.06) contrast(1.03) blur(${blur.toFixed(2)}px)`;
  }
}

function applyTheme(theme) {
  const isDark = theme === 'dark';

  document.body.classList.toggle('dark-theme', isDark);

  if (themeToggle) {
    const icon = themeToggle.querySelector('.theme-toggle-icon');
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';

    themeToggle.setAttribute(
      'aria-label',
      isDark ? 'Włącz jasny motyw' : 'Włącz ciemny motyw'
    );
  }
}

function loadTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(savedTheme);
}

function toggleTheme() {
  const isDark = document.body.classList.contains('dark-theme');
  const nextTheme = isDark ? 'light' : 'dark';

  localStorage.setItem(THEME_KEY, nextTheme);
  applyTheme(nextTheme);
}

/* =========================
   START
========================= */

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadSubstitutions();
  loadNews();
  loadClasses();
  bindQuickControls();
  loadDepartures();
  setInterval(() => loadDepartures({ silent: true }), 45000);
  onScroll();

  if (classSearch) {
    classSearch.addEventListener('input', () => {
      const q = classSearch.value.trim().toLowerCase();

      renderClassButtons(
        CLASSES.filter(c => c.name.toLowerCase().includes(q))
      );
    });
  }

  if (subToggle) {
    subToggle.addEventListener('click', () => {
      SUB_FILTER_OPEN = !SUB_FILTER_OPEN;
      renderSubstitutions(SUB_DATA);
    });
  }
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker działa 🚀');

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller &&
            !sessionStorage.getItem('sw-reloaded')
          ) {
            console.log('Wykryto nowe pliki aplikacji! Automatyczne odświeżenie...');
            sessionStorage.setItem('sw-reloaded', 'true');
            window.location.reload();
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        sessionStorage.removeItem('sw-reloaded');
      });

    } catch (err) {
      console.error('SW error:', err);
    }
  });
}

window.addEventListener('scroll', onScroll, { passive: true });