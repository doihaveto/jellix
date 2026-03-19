import { accessToken, verifyToken, logout, getAuthHeader } from './auth.js';
import { shuffle, ticksToSeconds, formatDuration, sortArrayByAppearance } from './utils.js';

// --- Constants ---

const MOVIES_SLIDER_START_COUNT = 20;
const NAVIGATION_COOLDOWN_MS = 150;
const SWIPER_LAZY_LOAD_THRESHOLD = 0.8;
const VIDEO_END_CHECK_INTERVAL_MS = 50;
const VIDEO_FADE_THRESHOLD_S = 1;
const SEARCH_DEBOUNCE_MS = 250;
const SEED = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''));

const GENRES_ORDER = [
  'Drama', 'Action', 'Comedy', 'Sci-Fi', 'Adventure', 'Crime',
  'Thriller', 'Family', 'Romance', 'Mystery', 'Animation', 'Biography',
  'History', 'Film-Noir', 'Fantasy', 'War', 'Science Fiction', 'Music',
  'Sport', 'Documentary', 'Musical', 'Western', 'TV Movie', 'Short',
  'Horror', 'Talk-Show',
];

const DEFAULT_SETTINGS = {
  filterHidePlayed: true,
  filterYearMin: 1900,
  filterYearMax: null,
  filterCommunityRatingsMin: 0,
  filterCriticRatingsMin: 0,
  filterRuntimeMinutes: 0,
  fontSize: 100,
  showNav: false,
  lang: null,
  trailer_timer: 7,
};

const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape']);

const SORT_OPTIONS = [
  { key: 'default', label: 'Default' },
  { key: 'rating', label: 'Rating' },
  { key: 'critic', label: 'Critic' },
  { key: 'year', label: 'Year' },
];

// --- State ---

let user;
let allMovies;
let lists = [];
let listsIdx = 0;
let activeSwiper;
let slideIdx;
let translation;
let settings = { ...DEFAULT_SETTINGS };
let canFire = true;
let fadeTimeout;
let checkPlayerTimeout;
let checkVideoEndInterval;
let player;
let trailerControlState;
let activeVideoId;
let searchActive = false;
let searchDebounceTimeout;
let headerFocused = false;
let headerFocusIdx = 0;
let sortMenuOpen = false;
let sortMenuIdx = 0;
let settingsFocusIdx = 0;

let contentMode = 'movies';
let movieCollectionId = null;
let seriesCollectionId = null;
let cachedMovies = null;
let cachedSeries = null;

// --- Cached DOM elements ---

const dom = {
  parentContainer: document.querySelector('.lists-container .container'),
  loadingScreen: document.querySelector('.loading-screen'),
  errors: document.querySelector('.errors'),
  background: document.querySelector('.background-container'),
  logoImage: document.querySelector('.feature-movie-logo'),
  title: document.querySelector('.movie-title'),
  overview: document.querySelector('.movie-overview'),
  playButton: document.querySelector('.play-button'),
  productionYear: document.querySelector('.production-year'),
  communityRating: document.querySelector('.community-rating'),
  criticRating: document.querySelector('.critic-rating'),
  genres: document.querySelector('.genres'),
  duration: document.querySelector('.duration'),
  playerContainer: document.getElementById('player-container'),
  trailerControl: document.querySelector('#trailer-control'),
  overlay: document.getElementById('overlay'),
  settingsButton: document.getElementById('settings-button'),
  settingsSave: document.querySelector('.settings-save'),
  fontSizeInput: document.querySelector('#setting-font-size'),
  logoutButton: document.querySelector('#logout-button'),
  navButtons: document.getElementById('nav-buttons'),
  searchButton: document.getElementById('search-button'),
  searchInput: document.getElementById('search-input'),
  contentToggle: document.getElementById('content-toggle'),
  movieDirector: document.querySelector('.movie-director'),
  movieWriter: document.querySelector('.movie-writer'),
  cast: document.querySelector('.movie-cast'),
};

// --- Settings persistence ---

const savedSettings = localStorage.getItem('movieSettings');
if (savedSettings) {
  Object.assign(settings, JSON.parse(savedSettings));
} else {
  localStorage.setItem('movieSettings', JSON.stringify(settings));
}

// --- Font size ---

function getAllCustomProperties() {
  const customProperties = [];
  for (const styleSheet of document.styleSheets) {
    try {
      const rules = styleSheet.cssRules || styleSheet.rules;
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (prop.startsWith('--') && !customProperties.includes(prop)) {
              customProperties.push(prop);
            }
          }
        }
      }
    } catch (_) {
      // Cross-origin stylesheets may throw
    }
  }
  return customProperties;
}

function getFontSizeProperties() {
  const result = {};
  getAllCustomProperties()
    .filter(p => p.startsWith('--jellix-') && p.endsWith('font-size'))
    .forEach(p => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(p);
      const match = value.match(/(\d+(\.\d+)?)(\S+)/);
      if (match) {
        result[p] = { value: parseFloat(match[1]), unit: match[3] };
      }
    });
  return result;
}

const fontSizeProperties = getFontSizeProperties();

function changeFontSize(percent = null) {
  if (percent === null) percent = settings.fontSize;
  for (const [prop, size] of Object.entries(fontSizeProperties)) {
    const newSize = size.value * (percent / 100);
    document.documentElement.style.setProperty(prop, newSize + size.unit);
  }
}

changeFontSize();

// --- Auth check ---

dom.logoutButton.addEventListener('click', logout);

if (accessToken) {
  verifyToken(
    accessToken,
    data => { user = data; refreshContent(); },
    () => { window.location.href = '/login.html'; }
  );
} else {
  window.location.href = '/login.html';
}

// --- Error display ---

function displayErrorMessage(error) {
  dom.errors.textContent = error;
}

// --- Loading screen ---

function showLoadingScreen() {
  dom.loadingScreen.style.opacity = '1';
  dom.loadingScreen.style.pointerEvents = 'auto';
}

function hideLoadingScreen() {
  dom.loadingScreen.style.opacity = '0';
  dom.loadingScreen.style.pointerEvents = 'none';
}

// --- Content data ---

async function getCollections() {
  const headers = { 'Authorization': getAuthHeader(accessToken) };
  const response = await fetch(`${API_URL}Items`, { headers });
  if (!response.ok) throw new Error('Failed to fetch collections');
  const data = await response.json();
  movieCollectionId = data.Items.find(x => x.CollectionType === 'movies')?.Id || null;
  seriesCollectionId = data.Items.find(x => x.CollectionType === 'tvshows')?.Id || null;
}

async function getItems(collectionId, itemType) {
  const headers = { 'Authorization': getAuthHeader(accessToken) };
  const response = await fetch(`${API_URL}Items?` + new URLSearchParams({
    ParentId: collectionId,
    fields: 'Genres,Tags,DateCreated,Overview,RemoteTrailers',
    enableImages: true,
    IncludeItemTypes: itemType,
    Recursive: true,
  }), { headers });
  if (!response.ok) throw new Error(`Failed to fetch ${itemType} items`);
  const data = await response.json();
  return data.Items;
}

async function refreshContent() {
  listsIdx = 0;
  searchActive = false;
  headerFocused = false;
  clearHeaderFocus();
  closeSortMenu();
  dom.searchInput.value = '';
  dom.searchInput.classList.remove('active');
  document.querySelectorAll('.thumbnails-group').forEach(x => x.remove());
  try {
    translation = await getTranslation();

    if (!movieCollectionId && !seriesCollectionId) {
      await getCollections();
    }

    dom.contentToggle.style.display = (movieCollectionId && seriesCollectionId) ? '' : 'none';

    if (contentMode === 'movies' && !movieCollectionId && seriesCollectionId) {
      contentMode = 'series';
    } else if (contentMode === 'series' && !seriesCollectionId && movieCollectionId) {
      contentMode = 'movies';
    }

    const collectionId = contentMode === 'movies' ? movieCollectionId : seriesCollectionId;
    const itemType = contentMode === 'movies' ? 'Movie' : 'Series';
    if (!collectionId) throw new Error('No media collection found');

    const items = await getItems(collectionId, itemType);
    if (contentMode === 'movies') cachedMovies = items;
    else cachedSeries = items;

    processItems(items);
    allMovies = items.reduce((obj, item) => (obj[item.Id] = item, obj), {});
    createLists(items);
    populateMovies();
    updateContentToggle();
    hideLoadingScreen();
  } catch (error) {
    displayErrorMessage(error.message);
    console.error('Error in refreshContent:', error);
  }
}

function switchContentMode() {
  contentMode = contentMode === 'movies' ? 'series' : 'movies';
  headerFocused = false;
  clearHeaderFocus();
  closeSortMenu();
  const cached = contentMode === 'movies' ? cachedMovies : cachedSeries;
  if (cached) {
    listsIdx = 0;
    searchActive = false;
    dom.searchInput.value = '';
    dom.searchInput.classList.remove('active');
    document.querySelectorAll('.thumbnails-group').forEach(x => x.remove());
    allMovies = cached.reduce((obj, item) => (obj[item.Id] = item, obj), {});
    createLists(cached);
    populateMovies();
    updateContentToggle();
  } else {
    showLoadingScreen();
    refreshContent();
  }
}

function updateContentToggle() {
  const icon = dom.contentToggle.querySelector('.material-symbols-outlined');
  if (contentMode === 'movies') {
    icon.textContent = 'live_tv';
    dom.contentToggle.title = 'Switch to TV series';
    dom.contentToggle.setAttribute('aria-label', 'Switch to TV series');
  } else {
    icon.textContent = 'movie';
    dom.contentToggle.title = 'Switch to movies';
    dom.contentToggle.setAttribute('aria-label', 'Switch to movies');
  }
  dom.searchInput.placeholder = contentMode === 'movies' ? 'Search movies...' : 'Search series...';
}

dom.contentToggle.addEventListener('click', switchContentMode);

async function getTranslation() {
  if (!settings.lang) return undefined;
  const response = await fetch(`/translations/${settings.lang}.json`);
  if (!response.ok) {
    throw new Error('Failed to fetch translation');
  }
  return response.json();
}

function processItems(items) {
  items.forEach(item => {
    if (item.RunTimeTicks) {
      item.durationSeconds = ticksToSeconds(item.RunTimeTicks);
      item.durationHuman = formatDuration(item.durationSeconds);
    }
  });
}

const creditsCache = {};

async function fetchCredits(movieId) {
  if (creditsCache[movieId]) return creditsCache[movieId];
  const headers = { 'Authorization': getAuthHeader(accessToken) };
  const response = await fetch(`${API_URL}Items/${movieId}?fields=People`, { headers });
  if (!response.ok) return null;
  const data = await response.json();
  const people = data.People || [];

  const directors = people.filter(p => p.Type === 'Director').map(p => p.Name);
  const writers = people.filter(p => p.Type === 'Writer').map(p => p.Name);
  const actors = people.filter(p => p.Type === 'Actor').slice(0, 3).map(p => ({
    name: p.Name,
    role: p.Role,
    imageUrl: p.PrimaryImageTag
      ? `${API_URL}Items/${p.Id}/Images/Primary?fillHeight=160&fillWidth=160&quality=90&tag=${p.PrimaryImageTag}`
      : null,
  }));

  const result = { directors, writers, actors };
  creditsCache[movieId] = result;
  return result;
}

function createLists(items) {
  items.sort((a, b) => a.Id.localeCompare(b.Id));
  lists = [];
  let i = 0;
  const label = contentMode === 'movies' ? 'movies' : 'series';

  lists.push({
    idx: i++,
    name: "Today's picks",
    movies: filterList(shuffle(items.map(m => m.Id), SEED)),
  });

  const latest = filterList(
    items.map(m => m.Id).sort((a, b) => new Date(allMovies[b].DateCreated) - new Date(allMovies[a].DateCreated))
  );
  lists.push({ idx: i++, name: `Latest ${label}`, movies: latest });

  const newest = filterList(
    items.filter(m => m.PremiereDate).map(m => m.Id)
      .sort((a, b) => new Date(allMovies[b].PremiereDate) - new Date(allMovies[a].PremiereDate))
  );
  lists.push({ idx: i++, name: `Newest ${label}`, movies: newest });

  const favourites = filterList(items.filter(m => m.UserData.IsFavorite).map(m => m.Id));
  if (favourites.length) {
    lists.push({ idx: i++, name: 'Favourites', movies: favourites });
  }

  const allGenres = [...new Set(items.reduce((acc, m) => acc.concat(m.Genres), []))];
  const sortedGenres = sortArrayByAppearance(GENRES_ORDER, allGenres);
  sortedGenres.forEach(genre => {
    const filtered = filterList(shuffle(items.filter(m => m.Genres.includes(genre)).map(m => m.Id), SEED));
    if (filtered.length) {
      lists.push({ idx: i++, name: genre, movies: filtered });
    }
  });

  lists.forEach(list => {
    list.originalMovies = [...list.movies];
    list.sortBy = 'default';
  });
}

function filterList(movieIds) {
  return movieIds.filter(movieId => {
    const movie = allMovies[movieId];
    return !(
      (settings.filterHidePlayed && movie.UserData.Played) ||
      (settings.filterYearMin && movie.ProductionYear < settings.filterYearMin) ||
      (settings.filterYearMax && movie.ProductionYear > settings.filterYearMax) ||
      (settings.filterCommunityRatingsMin && (movie.CommunityRating || 0) < settings.filterCommunityRatingsMin) ||
      (settings.filterCriticRatingsMin && (movie.CriticRating || 0) < settings.filterCriticRatingsMin) ||
      (settings.filterRuntimeMinutes && (movie.durationSeconds || 0) / 60 > settings.filterRuntimeMinutes)
    );
  });
}

// --- Thumbnails ---

function createThumbnailSlide(movie) {
  const imageTag = movie.ImageTags?.Primary;
  const thumbnail = document.createElement('div');
  thumbnail.classList.add('movie-thumbnail', 'skeleton');

  const img = document.createElement('img');
  img.alt = movie.Name;
  img.loading = 'lazy';

  if (imageTag) {
    img.src = `${API_URL}Items/${movie.Id}/Images/Primary?fillHeight=608&fillWidth=406&quality=96&tag=${imageTag}`;
    img.addEventListener('load', () => thumbnail.classList.remove('skeleton'));
    img.addEventListener('error', () => thumbnail.classList.remove('skeleton'));
  } else {
    thumbnail.classList.remove('skeleton');
    thumbnail.classList.add('no-image');
  }

  thumbnail.appendChild(img);
  thumbnail.dataset.movieId = movie.Id;
  thumbnail.addEventListener('click', () => displayMovieInfo(movie, thumbnail));

  const slide = document.createElement('div');
  slide.classList.add('swiper-slide');
  slide.dataset.id = movie.Id;
  slide.appendChild(thumbnail);
  return slide;
}

function displayMovieInfo(movie, thumbnail) {
  if (thumbnail) {
    const group = thumbnail.closest('.thumbnails-group');
    if (group) {
      listsIdx = parseInt(group.dataset.idx, 10);
      const slide = thumbnail.closest('.swiper-slide');
      const wrapper = group.querySelector('.swiper-wrapper');
      const slides = wrapper ? [...wrapper.querySelectorAll('.swiper-slide')] : [];
      slideIdx = slide ? slides.indexOf(slide) : 0;
    }
  }

  document.querySelectorAll('.movie-selected').forEach(x => x.classList.remove('movie-selected'));
  thumbnail?.classList.add('movie-selected');

  const backdropTag = movie.BackdropImageTags?.[0];
  const logoTag = movie.ImageTags?.Logo;
  const backdropUrl = backdropTag
    ? `${API_URL}Items/${movie.Id}/Images/Backdrop?fillWidth=960&fillHeight=840&quality=96&tag=${backdropTag}`
    : '';
  const logoUrl = logoTag
    ? `${API_URL}Items/${movie.Id}/Images/Logo?fillWidth=640&fillHeight=360&quality=96&tag=${logoTag}`
    : '';

  dom.playButton.href = `${API_URL}web/index.html#!/details?id=${movie.Id}&serverId=${movie.ServerId}`;
  dom.background.style.backgroundImage = `url(${backdropUrl})`;

  if (logoTag) {
    dom.logoImage.src = logoUrl;
    dom.title.style.display = 'none';
    dom.logoImage.style.display = 'block';
  } else {
    dom.title.style.display = 'block';
    dom.logoImage.style.display = 'none';
  }

  const hasTranslation = translation?.movies?.[movie.Id];
  dom.title.textContent = hasTranslation ? translation.movies[movie.Id].title : movie.Name;
  dom.overview.textContent = hasTranslation ? translation.movies[movie.Id].description : (movie.Overview || '');

  clearPlayer();
  if (movie.RemoteTrailers?.length && settings.trailer_timer !== null) {
    playVideo(movie.RemoteTrailers[0].Url);
  }

  dom.productionYear.textContent = movie.ProductionYear || '';

  if (movie.CommunityRating) {
    dom.communityRating.textContent = movie.CommunityRating;
    dom.communityRating.style.display = '';
  } else {
    dom.communityRating.style.display = 'none';
  }

  if (movie.CriticRating) {
    dom.criticRating.textContent = movie.CriticRating;
    dom.criticRating.style.display = '';
  } else {
    dom.criticRating.style.display = 'none';
  }

  if (translation?.interface?.genres) {
    dom.genres.textContent = movie.Genres.map(g => translation.interface.genres[g] || g).join(', ');
  } else {
    dom.genres.textContent = movie.Genres.join(', ');
  }

  dom.duration.textContent = movie.durationHuman || '';

  dom.movieDirector.textContent = '';
  dom.movieWriter.textContent = '';
  dom.cast.innerHTML = '';
  loadCredits(movie.Id);
}

async function loadCredits(movieId) {
  const credits = await fetchCredits(movieId);
  if (!credits) return;

  const activeList = lists.find(x => x.idx === listsIdx);
  if (!activeList || allMovies[activeList.movies[slideIdx]]?.Id !== movieId) return;

  dom.movieDirector.textContent = credits.directors.length ? `Director: ${credits.directors.join(', ')}` : '';
  dom.movieWriter.textContent = credits.writers.length ? `Writer: ${credits.writers.join(', ')}` : '';

  dom.cast.innerHTML = '';
  credits.actors.forEach(actor => {
    const item = document.createElement('div');
    item.classList.add('cast-item');

    const img = document.createElement('div');
    img.classList.add('cast-photo');
    if (actor.imageUrl) {
      const photo = document.createElement('img');
      photo.src = actor.imageUrl;
      photo.alt = actor.name;
      photo.loading = 'lazy';
      img.appendChild(photo);
    } else {
      img.innerHTML = '<span class="material-symbols-outlined">person</span>';
    }
    item.appendChild(img);

    const name = document.createElement('div');
    name.classList.add('cast-name');
    name.textContent = actor.name;
    item.appendChild(name);

    dom.cast.appendChild(item);
  });
}

// --- Populate movies (list rendering) ---

function populateMovies() {
  if (!lists.length) return;

  const displayedIds = [...document.querySelectorAll('.thumbnails-group')].map(x => parseInt(x.dataset.idx));

  lists.slice(listsIdx, listsIdx + 2).forEach(list => {
    if (displayedIds.includes(list.idx)) return;

    const thumbnailsGroup = document.createElement('div');
    thumbnailsGroup.dataset.idx = list.idx;
    thumbnailsGroup.classList.add('thumbnails-group');
    thumbnailsGroup.innerHTML = `
      <div class="thumbnails-title"></div>
      <div class="thumbnails">
        <div class="sort-trigger" title="Sort this row">
          <span class="material-symbols-outlined">sort</span>
        </div>
        <div class="sort-menu">
          ${SORT_OPTIONS.map(o => `<div class="sort-option" data-sort="${o.key}">${o.label}</div>`).join('')}
        </div>
        <div class="swiper">
          <div class="swiper-wrapper"></div>
        </div>
      </div>
    `;

    thumbnailsGroup.querySelector('.thumbnails-title').textContent = list.name + ':';
    const sortActive = list.sortBy || 'default';
    thumbnailsGroup.querySelectorAll('.sort-option').forEach(el => {
      el.classList.toggle('sort-active', el.dataset.sort === sortActive);
    });
    const wrapper = thumbnailsGroup.querySelector('.swiper-wrapper');
    list.movies.forEach((movieId, idx) => {
      if (idx >= MOVIES_SLIDER_START_COUNT) return;
      wrapper.appendChild(createThumbnailSlide(allMovies[movieId]));
    });

    attachSortListeners(thumbnailsGroup);
    thumbnailsGroup.style.display = 'none';
    if (displayedIds.length && list.idx < Math.min(...displayedIds)) {
      dom.parentContainer.insertBefore(thumbnailsGroup, dom.parentContainer.firstChild);
    } else {
      dom.parentContainer.appendChild(thumbnailsGroup);
    }
    displayedIds.push(list.idx);
  });

  let flag = false;
  if (displayedIds.length < 2) {
    // Single list (e.g. search results) — just show it, no transition needed
    document.querySelectorAll('.thumbnails-group').forEach(x => x.style.display = '');
    flag = true;
  } else if (displayedIds.length === 2) {
    document.querySelectorAll('.thumbnails-group').forEach(x => x.style.display = '');
    dom.parentContainer.style.height = `${dom.parentContainer.offsetHeight + 1}px`;
    flag = true;
  } else if (listsIdx === Math.min(...displayedIds) || (listsIdx === lists.length - 2 && displayedIds.length === 2)) {
    document.querySelector('.thumbnails-group:last-child').remove();
    const currentGroup = document.querySelector('.thumbnails-group');
    if (currentGroup) {
      const visibleGroup = document.querySelectorAll('.thumbnails-group')[1] || currentGroup;
      currentGroup.style.marginTop = `calc(-${visibleGroup.offsetHeight}px - ${getComputedStyle(visibleGroup).marginBottom})`;
      currentGroup.style.display = '';
      setTimeout(() => currentGroup.style.marginTop = '0', 20);
    }
    flag = true;
  }

  if (!flag || (listsIdx === lists.length - 1 && displayedIds.length > 1)) {
    const collapseGroup = document.querySelector('.thumbnails-group');
    if (collapseGroup) {
      collapseGroup.style.marginTop = `calc(-${collapseGroup.offsetHeight}px - ${getComputedStyle(collapseGroup).marginBottom})`;
      document.querySelectorAll('.thumbnails-group').forEach(x => x.style.display = '');
      setTimeout(() => collapseGroup.remove(), 100);
    }
  }

  const swiperEl = [...document.querySelectorAll('.thumbnails-group')]
    .find(x => x.dataset.idx == listsIdx)
    ?.querySelector('.swiper');
  if (!swiperEl) return;

  activeSwiper = swiperEl.swiper;
  if (activeSwiper === undefined) {
    activeSwiper = new Swiper(swiperEl, {
      direction: 'horizontal',
      loop: false,
      initialSlide: 0,
      slidesPerView: 'auto',
      on: {
        sliderMove: updateSwiper,
        slideChange: updateSwiper,
      },
    });
    activeSwiper.jx_last_list_idx = MOVIES_SLIDER_START_COUNT - 1;
  } else {
    activeSwiper.slideTo(0);
  }

  const activeList = lists.find(x => x.idx === listsIdx);
  if (activeList && activeList.movies.length) {
    const firstThumbnail = [...document.querySelectorAll('.thumbnails-group')]
      .find(x => x.dataset.idx == listsIdx)
      .querySelector('.movie-thumbnail');
    displayMovieInfo(allMovies[activeList.movies[0]], firstThumbnail);
  }
  slideIdx = 0;
  closeSortMenu();
  updateSortHint();
}

function updateSwiper(swiper) {
  if (swiper.progress > SWIPER_LAZY_LOAD_THRESHOLD && swiper.jx_last_list_idx < lists[listsIdx].movies.length - 1) {
    swiper.jx_last_list_idx++;
    const movieId = lists[listsIdx].movies[swiper.jx_last_list_idx];
    swiper.appendSlide(createThumbnailSlide(allMovies[movieId]));
    swiper.update();
  }
}

// --- Sort menu ---

function updateSortHint() {
  document.querySelectorAll('.thumbnails-group.sort-hint').forEach(el => el.classList.remove('sort-hint'));
  if (slideIdx === 0 && !sortMenuOpen && !headerFocused) {
    const group = [...document.querySelectorAll('.thumbnails-group')].find(x => parseInt(x.dataset.idx) === listsIdx);
    if (group) group.classList.add('sort-hint');
  }
}

function openSortMenu() {
  const list = lists.find(x => x.idx === listsIdx);
  if (!list) return;
  sortMenuOpen = true;
  sortMenuIdx = SORT_OPTIONS.findIndex(o => o.key === (list.sortBy || 'default'));
  if (sortMenuIdx < 0) sortMenuIdx = 0;
  const group = [...document.querySelectorAll('.thumbnails-group')].find(x => parseInt(x.dataset.idx) === listsIdx);
  if (group) {
    group.classList.add('sort-menu-open');
    group.classList.remove('sort-hint');
    updateSortMenuFocus(group);
  }
}

function closeSortMenu() {
  sortMenuOpen = false;
  document.querySelectorAll('.sort-menu-open').forEach(el => el.classList.remove('sort-menu-open'));
  document.querySelectorAll('.sort-focused').forEach(el => el.classList.remove('sort-focused'));
  updateSortHint();
}

function updateSortMenuFocus(group) {
  if (!group) group = [...document.querySelectorAll('.thumbnails-group')].find(x => parseInt(x.dataset.idx) === listsIdx);
  if (!group) return;
  group.querySelectorAll('.sort-option').forEach((el, i) => {
    el.classList.toggle('sort-focused', i === sortMenuIdx);
  });
}

function applySort(sortKey) {
  const list = lists.find(x => x.idx === listsIdx);
  if (!list) return;
  if (list.sortBy === sortKey) return;
  list.sortBy = sortKey;

  if (sortKey === 'default') {
    list.movies = [...list.originalMovies];
  } else if (sortKey === 'rating') {
    list.movies = [...list.originalMovies].sort((a, b) =>
      (allMovies[b].CommunityRating || 0) - (allMovies[a].CommunityRating || 0));
  } else if (sortKey === 'year') {
    list.movies = [...list.originalMovies].sort((a, b) =>
      (allMovies[b].ProductionYear || 0) - (allMovies[a].ProductionYear || 0));
  } else if (sortKey === 'critic') {
    list.movies = [...list.originalMovies].sort((a, b) =>
      (allMovies[b].CriticRating || 0) - (allMovies[a].CriticRating || 0));
  }

  rebuildActiveSwiper(list);

  const group = [...document.querySelectorAll('.thumbnails-group')].find(x => parseInt(x.dataset.idx) === listsIdx);
  if (group) {
    group.querySelectorAll('.sort-option').forEach(el => {
      el.classList.toggle('sort-active', el.dataset.sort === sortKey);
    });
  }
}

function rebuildActiveSwiper(list) {
  const group = [...document.querySelectorAll('.thumbnails-group')].find(x => parseInt(x.dataset.idx) === list.idx);
  if (!group) return;

  const swiperEl = group.querySelector('.swiper');
  if (swiperEl?.swiper) swiperEl.swiper.destroy(true, true);

  const wrapper = group.querySelector('.swiper-wrapper');
  wrapper.innerHTML = '';
  list.movies.forEach((movieId, idx) => {
    if (idx >= MOVIES_SLIDER_START_COUNT) return;
    wrapper.appendChild(createThumbnailSlide(allMovies[movieId]));
  });

  activeSwiper = new Swiper(swiperEl, {
    direction: 'horizontal',
    loop: false,
    initialSlide: 0,
    slidesPerView: 'auto',
    on: {
      sliderMove: updateSwiper,
      slideChange: updateSwiper,
    },
  });
  activeSwiper.jx_last_list_idx = Math.min(MOVIES_SLIDER_START_COUNT - 1, list.movies.length - 1);

  slideIdx = 0;
  if (list.movies.length) {
    const firstThumbnail = wrapper.querySelector('.movie-thumbnail');
    displayMovieInfo(allMovies[list.movies[0]], firstThumbnail);
  }
  updateSortHint();
}

function attachSortListeners(group) {
  const trigger = group.querySelector('.sort-trigger');
  if (trigger) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sortMenuOpen && parseInt(group.dataset.idx) === listsIdx) {
        closeSortMenu();
      } else {
        listsIdx = parseInt(group.dataset.idx);
        openSortMenu();
      }
    });
  }
  group.querySelectorAll('.sort-option').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      listsIdx = parseInt(group.dataset.idx);
      applySort(el.dataset.sort);
      closeSortMenu();
    });
  });
}

// --- Header focus (TV remote support) ---

function getHeaderButtons() {
  return [dom.searchButton, dom.contentToggle, dom.settingsButton, dom.logoutButton]
    .filter(btn => btn && btn.style.display !== 'none' && !btn.closest('[style*="display: none"]'));
}

function updateHeaderFocus() {
  const buttons = getHeaderButtons();
  if (!buttons.length) return;
  headerFocusIdx = Math.max(0, Math.min(headerFocusIdx, buttons.length - 1));
  clearHeaderFocus();
  buttons[headerFocusIdx].classList.add('header-focused');
}

function clearHeaderFocus() {
  document.querySelectorAll('.header-focused').forEach(el => el.classList.remove('header-focused'));
}

// --- Navigation ---

function handleRightAction() {
  if (headerFocused) {
    headerFocusIdx++;
    updateHeaderFocus();
    return;
  }
  if (sortMenuOpen) {
    closeSortMenu();
    return;
  }
  const activeList = lists.find(x => x.idx === listsIdx);
  if (!activeList || !activeList.movies.length) return;
  const movieIds = activeList.movies;
  if (slideIdx + 1 < movieIds.length) {
    slideIdx++;
    updateSortHint();
    const movie = allMovies[movieIds[slideIdx]];
    const slide = activeSwiper.slides.find(x => x.dataset.id === movie.Id);
    displayMovieInfo(movie, slide.querySelector('.movie-thumbnail'));
    if (!activeSwiper.isEnd) activeSwiper.slideNext();
  }
}

function handleLeftAction() {
  if (headerFocused) {
    headerFocusIdx--;
    updateHeaderFocus();
    return;
  }
  if (sortMenuOpen) return;
  const activeList = lists.find(x => x.idx === listsIdx);
  if (!activeList || !activeList.movies.length) return;
  const movieIds = activeList.movies;
  if (slideIdx === 0) {
    openSortMenu();
    return;
  }
  slideIdx--;
  updateSortHint();
  const movie = allMovies[movieIds[slideIdx]];
  const slide = activeSwiper.slides.find(x => x.dataset.id === movie.Id);
  displayMovieInfo(movie, slide.querySelector('.movie-thumbnail'));
  if (!activeSwiper.isBeginning) activeSwiper.slidePrev();
}

function handleUpAction() {
  if (sortMenuOpen) {
    if (sortMenuIdx > 0) {
      sortMenuIdx--;
      updateSortMenuFocus();
    }
    return;
  }
  if (headerFocused) return;
  if (!lists.length) return;
  if (listsIdx === 0) {
    headerFocused = true;
    headerFocusIdx = 0;
    updateHeaderFocus();
    return;
  }
  listsIdx--;
  populateMovies();
}

function handleDownAction() {
  if (sortMenuOpen) {
    if (sortMenuIdx < SORT_OPTIONS.length - 1) {
      sortMenuIdx++;
      updateSortMenuFocus();
    }
    return;
  }
  if (headerFocused) {
    headerFocused = false;
    clearHeaderFocus();
    return;
  }
  if (!lists.length) return;
  if (lists.length > listsIdx + 1) {
    listsIdx++;
    populateMovies();
  }
}

function handleEnterAction() {
  if (sortMenuOpen) {
    applySort(SORT_OPTIONS[sortMenuIdx].key);
    closeSortMenu();
    return;
  }
  if (headerFocused) {
    const buttons = getHeaderButtons();
    const btn = buttons[headerFocusIdx];
    if (btn) {
      headerFocused = false;
      clearHeaderFocus();
      btn.click();
    }
    return;
  }
  dom.playButton.click();
}

function cooldown() {
  canFire = false;
  setTimeout(() => { canFire = true; }, NAVIGATION_COOLDOWN_MS);
}

document.addEventListener('wheel', (event) => {
  if (!canFire || document.activeElement === dom.searchInput) return;
  if (event.deltaY < 0) handleUpAction();
  else handleDownAction();
  cooldown();
});

document.addEventListener('keydown', (event) => {
  if (document.activeElement === dom.searchInput) {
    if (event.key === 'Escape') {
      closeSearch();
    } else if (event.key === 'Enter') {
      clearTimeout(searchDebounceTimeout);
      performSearch(dom.searchInput.value);
    }
    return;
  }
  if (dom.overlay.classList.contains('show')) {
    handleSettingsKey(event);
    return;
  }
  if (!canFire || !NAVIGATION_KEYS.has(event.key)) return;
  if (event.key === 'Escape') {
    if (sortMenuOpen) closeSortMenu();
    cooldown();
    return;
  }
  switch (event.key) {
    case 'ArrowUp': handleUpAction(); break;
    case 'ArrowDown': handleDownAction(); break;
    case 'ArrowRight': handleRightAction(); break;
    case 'ArrowLeft': handleLeftAction(); break;
    case 'Enter': handleEnterAction(); break;
  }
  cooldown();
});

document.getElementById('nav-up').addEventListener('click', handleUpAction);
document.getElementById('nav-down').addEventListener('click', handleDownAction);
document.getElementById('nav-left').addEventListener('click', handleLeftAction);
document.getElementById('nav-right').addEventListener('click', handleRightAction);

// --- Search ---

dom.searchButton.addEventListener('click', () => {
  closeSortMenu();
  if (dom.searchInput.classList.contains('active')) {
    closeSearch();
  } else {
    dom.searchInput.classList.add('active');
    dom.searchInput.focus();
  }
});

dom.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimeout);
  searchDebounceTimeout = setTimeout(() => {
    performSearch(dom.searchInput.value);
  }, SEARCH_DEBOUNCE_MS);
});

function performSearch(query) {
  if (!allMovies) return;

  listsIdx = 0;
  document.querySelectorAll('.thumbnails-group').forEach(x => x.remove());

  const trimmed = query.trim();
  if (!trimmed) {
    searchActive = false;
    createLists(Object.values(allMovies));
    if (lists.length) populateMovies();
    return;
  }

  searchActive = true;
  const normalized = trimmed.toLowerCase();

  const nameMatchIds = Object.values(allMovies)
    .filter(movie => {
      const name = movie.Name?.toLowerCase() || '';
      const originalTitle = movie.OriginalTitle?.toLowerCase() || '';
      const translatedTitle = translation?.movies?.[movie.Id]?.title?.toLowerCase() || '';
      return name.includes(normalized) || originalTitle.includes(normalized) || translatedTitle.includes(normalized);
    })
    .map(m => m.Id);

  const nameMatchSet = new Set(nameMatchIds);
  const tagMatchIds = Object.values(allMovies)
    .filter(movie => {
      if (nameMatchSet.has(movie.Id)) return false;
      const tags = movie.Tags || [];
      return tags.some(tag => (tag || '').toLowerCase().includes(normalized));
    })
    .map(m => m.Id);

  const matchingIds = [...nameMatchIds, ...tagMatchIds];
  const filtered = filterList(matchingIds);

  lists = [];
  if (filtered.length) {
    lists.push({ idx: 0, name: `Search: "${trimmed}"`, movies: filtered, originalMovies: [...filtered], sortBy: 'default' });
    populateMovies();
  } else {
    const noResults = document.createElement('div');
    noResults.classList.add('thumbnails-group');
    noResults.dataset.idx = 0;
    const title = document.createElement('div');
    title.classList.add('thumbnails-title');
    title.textContent = contentMode === 'movies' ? 'No movies found' : 'No series found';
    noResults.appendChild(title);
    dom.parentContainer.appendChild(noResults);
  }
}

function closeSearch() {
  headerFocused = false;
  clearHeaderFocus();
  closeSortMenu();
  dom.searchInput.classList.remove('active');
  dom.searchInput.value = '';
  dom.searchInput.blur();
  clearTimeout(searchDebounceTimeout);
  if (searchActive && allMovies) {
    searchActive = false;
    listsIdx = 0;
    document.querySelectorAll('.thumbnails-group').forEach(x => x.remove());
    createLists(Object.values(allMovies));
    if (lists.length) populateMovies();
  }
  searchActive = false;
}

// --- YouTube trailers ---

function extractYouTubeId(url) {
  const match = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function initYouTubePlayer() {
  if (player) return;
  player = new YT.Player('youtube-player', {
    playerVars: {
      rel: 0,
      autoplay: 1,
      loop: 1,
      controls: 0,
      origin: window.location.origin,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onAutoplayBlocked: onPlayerAutoplayBlocked,
    },
  });
}

window.onYouTubeIframeAPIReady = initYouTubePlayer;
if (typeof YT !== 'undefined' && YT.Player) {
  initYouTubePlayer();
}

function onPlayerReady() {}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    if (player.getVideoData().video_id !== activeVideoId) return;
    dom.playerContainer.classList.add('visible');
    player.unMute();
    dom.trailerControl.textContent = 'Stop trailer';
    dom.trailerControl.style.display = '';
    trailerControlState = 'stop';
    startCheckingVideoTime();
  } else if (event.data === YT.PlayerState.ENDED) {
    clearInterval(checkVideoEndInterval);
  } else if (event.data === YT.PlayerState.PAUSED) {
    clearInterval(checkVideoEndInterval);
  } else if (event.data === YT.PlayerState.UNSTARTED) {
    clearInterval(checkVideoEndInterval);
    hidePlayer();
  }
}

function onPlayerAutoplayBlocked() {
  hidePlayer();
}

function startCheckingVideoTime() {
  clearInterval(checkVideoEndInterval);
  checkVideoEndInterval = setInterval(() => {
    if (player?.getDuration && player?.getCurrentTime) {
      const remaining = player.getDuration() - player.getCurrentTime();
      if (remaining <= VIDEO_FADE_THRESHOLD_S) {
        clearInterval(checkVideoEndInterval);
        hidePlayer();
      }
    }
  }, VIDEO_END_CHECK_INTERVAL_MS);
}

function hidePlayer() {
  dom.playerContainer.classList.remove('visible');
  dom.trailerControl.style.display = 'none';
}

function playVideo(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) return;

  const checkPlayerReady = () => {
    if (player && typeof player.loadVideoById === 'function') {
      fadeTimeout = setTimeout(() => {
        activeVideoId = videoId;
        player.loadVideoById(videoId);
      }, settings.trailer_timer * 1000);
    } else {
      checkPlayerTimeout = setTimeout(checkPlayerReady, 10);
    }
  };
  checkPlayerReady();
}

function clearPlayer() {
  activeVideoId = null;
  clearTimeout(checkPlayerTimeout);
  clearTimeout(fadeTimeout);
  clearInterval(checkVideoEndInterval);
  hidePlayer();
  if (player && typeof player.mute === 'function') {
    player.mute();
  }
}

dom.trailerControl.addEventListener('click', () => {
  if (!player) return;
  if (trailerControlState === 'stop') {
    player.mute();
    dom.playerContainer.classList.remove('visible');
    dom.trailerControl.textContent = 'Disable trailers';
    trailerControlState = 'disable';
  } else if (trailerControlState === 'disable') {
    settings.trailer_timer = null;
    dom.trailerControl.style.display = 'none';
  }
});

// --- Settings ---

function getSettingsControls() {
  const panel = document.getElementById('settings');
  const controls = [];
  const closeBtn = panel.querySelector('.settings-close');
  if (closeBtn) controls.push(closeBtn);
  panel.querySelectorAll('.settings-section').forEach(section => {
    if (section.style.display === 'none') return;
    section.querySelectorAll('input, select').forEach(el => controls.push(el));
  });
  const saveBtn = panel.querySelector('.settings-save');
  if (saveBtn) controls.push(saveBtn);
  return controls;
}

function updateSettingsFocus() {
  const controls = getSettingsControls();
  if (!controls.length) return;
  settingsFocusIdx = Math.max(0, Math.min(settingsFocusIdx, controls.length - 1));
  clearSettingsFocus();
  const control = controls[settingsFocusIdx];
  const row = control.closest('.settings-row');
  if (row) {
    row.classList.add('settings-row-focused');
  } else {
    control.classList.add('settings-btn-focused');
  }
}

function clearSettingsFocus() {
  document.querySelectorAll('.settings-row-focused, .settings-btn-focused')
    .forEach(el => el.classList.remove('settings-row-focused', 'settings-btn-focused'));
}

function openSettings() {
  dom.overlay.classList.add('show');
  settingsFocusIdx = 0;
  updateSettingsFocus();
}

function closeSettings() {
  dom.overlay.classList.remove('show');
  clearSettingsFocus();
}

function handleSettingsKey(event) {
  const insideInput = document.activeElement?.closest('.settings') &&
    (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT');
  if (insideInput) {
    if (event.key === 'Escape') {
      document.activeElement.blur();
      event.preventDefault();
    }
    return;
  }
  if (!NAVIGATION_KEYS.has(event.key)) return;
  event.preventDefault();
  const controls = getSettingsControls();
  switch (event.key) {
    case 'ArrowUp':
      settingsFocusIdx--;
      updateSettingsFocus();
      break;
    case 'ArrowDown':
      settingsFocusIdx++;
      updateSettingsFocus();
      break;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const ctrl = controls[settingsFocusIdx];
      if (!ctrl) break;
      const dir = event.key === 'ArrowRight' ? 1 : -1;
      if (ctrl.type === 'checkbox') {
        ctrl.checked = !ctrl.checked;
        ctrl.dispatchEvent(new Event('change'));
      } else if (ctrl.type === 'number') {
        const step = parseFloat(ctrl.step) || 1;
        const val = parseFloat(ctrl.value) || 0;
        const min = ctrl.min !== '' ? parseFloat(ctrl.min) : -Infinity;
        const max = ctrl.max !== '' ? parseFloat(ctrl.max) : Infinity;
        ctrl.value = Math.max(min, Math.min(max, +(val + step * dir).toFixed(4)));
        ctrl.dispatchEvent(new Event('change'));
      } else if (ctrl.tagName === 'SELECT') {
        const idx = Math.max(0, Math.min(ctrl.options.length - 1, ctrl.selectedIndex + dir));
        ctrl.selectedIndex = idx;
        ctrl.dispatchEvent(new Event('change'));
      }
      break;
    }
    case 'Enter': {
      const ctrl = controls[settingsFocusIdx];
      if (!ctrl) break;
      if (ctrl.type === 'checkbox') {
        ctrl.checked = !ctrl.checked;
        ctrl.dispatchEvent(new Event('change'));
      } else if (ctrl.tagName === 'BUTTON') {
        ctrl.click();
      } else {
        ctrl.focus();
      }
      break;
    }
    case 'Escape':
      closeSettings();
      break;
  }
}

dom.settingsButton.addEventListener('click', openSettings);
document.querySelector('.settings-close').addEventListener('click', closeSettings);

dom.fontSizeInput.addEventListener('change', () => changeFontSize(parseInt(dom.fontSizeInput.value)));

function saveSettings() {
  localStorage.setItem('movieSettings', JSON.stringify(settings));
}

function initializeSettings() {
  document.getElementById('setting-show-nav').checked = settings.showNav;
  document.getElementById('filter-hide-played').checked = settings.filterHidePlayed;
  document.getElementById('filter-year-min').value = settings.filterYearMin || '';
  document.getElementById('filter-year-max').value = settings.filterYearMax || '';
  document.getElementById('filter-community-ratings-min').value = settings.filterCommunityRatingsMin;
  document.getElementById('filter-critic-ratings-min').value = settings.filterCriticRatingsMin;
  document.getElementById('filter-runtime-minutes').value = settings.filterRuntimeMinutes;
  document.getElementById('setting-font-size').value = settings.fontSize;
  document.getElementById('setting-trailer-timer').value = settings.trailer_timer ?? '';

  document.getElementById('indicator-unplayed-filter').style.display = settings.filterHidePlayed ? '' : 'none';

  if ((settings.filterYearMin && settings.filterYearMin > 1900) || settings.filterYearMax) {
    const yearMin = settings.filterYearMin === 1900 ? null : settings.filterYearMin;
    const yearMax = settings.filterYearMax;
    let yearRange = '';
    if (yearMin && yearMax) yearRange = `${yearMin}-${yearMax}`;
    else if (yearMin) yearRange = `${yearMin}+`;
    else if (yearMax) yearRange = `-${yearMax}`;
    document.getElementById('indicator-year-filter').style.display = '';
    document.getElementById('indicator-year-filter').textContent = yearRange;
  } else {
    document.getElementById('indicator-year-filter').style.display = 'none';
  }

  document.getElementById('indicator-community-rating-filter').style.display = settings.filterCommunityRatingsMin ? '' : 'none';
  document.getElementById('indicator-community-rating-filter').textContent = settings.filterCommunityRatingsMin + '+';
  document.getElementById('indicator-critic-rating-filter').style.display = settings.filterCriticRatingsMin ? '' : 'none';
  document.getElementById('indicator-critic-rating-filter').textContent = settings.filterCriticRatingsMin + '+';
  document.getElementById('indicator-runtime-minutes-filter').style.display = settings.filterRuntimeMinutes ? '' : 'none';
  document.getElementById('indicator-runtime-minutes-filter').textContent = settings.filterRuntimeMinutes + 'm+';

  const hasFilters = [...document.querySelectorAll('.filter-indicators > span')].some(x => x.style.display !== 'none');
  document.querySelector('.filter-indicators').style.display = hasFilters ? '' : 'none';

  dom.navButtons.style.display = settings.showNav ? 'block' : 'none';

  const translationsContainer = document.getElementById('setting-translations-container');
  const translationsSelect = document.getElementById('setting-translations');
  if (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS && TRANSLATIONS.trim() !== '') {
    translationsContainer.style.display = 'block';
    const translationsArray = TRANSLATIONS.split(',').map(s => s.trim());
    const existingOptions = Array.from(translationsSelect.options).map(o => o.value);
    translationsArray.forEach(lang => {
      if (!existingOptions.includes(lang)) {
        const option = document.createElement('option');
        option.value = lang;
        option.text = lang;
        translationsSelect.appendChild(option);
      }
    });
    translationsSelect.value = settings.lang || '';
    if (settings.lang === 'he' || settings.lang === 'ar') {
      document.body.classList.add('rtl');
    } else {
      document.body.classList.remove('rtl');
    }
  } else {
    translationsContainer.style.display = 'none';
  }

  if (settings.trailer_timer === null) {
    if (player && typeof player.mute === 'function') player.mute();
    hidePlayer();
  }
}

dom.settingsSave.addEventListener('click', function () {
  closeSettings();
  settings.showNav = document.getElementById('setting-show-nav').checked;
  settings.filterHidePlayed = document.getElementById('filter-hide-played').checked;
  settings.filterYearMin = parseInt(document.getElementById('filter-year-min').value) || 1900;
  settings.filterYearMax = parseInt(document.getElementById('filter-year-max').value) || null;
  settings.filterCommunityRatingsMin = parseFloat(document.getElementById('filter-community-ratings-min').value) || 0;
  settings.filterCriticRatingsMin = parseInt(document.getElementById('filter-critic-ratings-min').value) || 0;
  settings.filterRuntimeMinutes = parseInt(document.getElementById('filter-runtime-minutes').value) || 0;
  settings.fontSize = parseInt(document.getElementById('setting-font-size').value) || 100;
  settings.lang = document.getElementById('setting-translations').value;
  settings.trailer_timer = parseFloat(document.getElementById('setting-trailer-timer').value) || null;
  saveSettings();
  initializeSettings();
  showLoadingScreen();
  refreshContent();
});

initializeSettings();
