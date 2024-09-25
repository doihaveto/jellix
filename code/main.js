var user;
var allMovies;
var lists = [];
var listsIdx = 0;
var activeSwiper;
var slideIdx;
var translation;
const moviesSliderStartCount = 20;
const seed = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
let settings = {
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

const genresOrder = [
  'Drama',
  'Action',
  'Comedy',
  'Sci-Fi',
  'Adventure',
  'Crime',
  'Thriller',
  'Family',
  'Romance',
  'Mystery',
  'Animation',
  'Biography',
  'History',
  'Film-Noir',
  'Fantasy',
  'War',
  'Science Fiction',
  'Music',
  'Sport',
  'Documentary',
  'Musical',
  'Western',
  'TV Movie',
  'Short',
  'Horror',
  'Talk-Show',
];

const parentContainer = document.querySelector('.lists-container .container');

// Retrieve settings from localStorage if available
if (localStorage.getItem('movieSettings')) {
  const savedSettings = JSON.parse(localStorage.getItem('movieSettings'));
  settings = { ...settings, ...savedSettings };
} else {
  localStorage.setItem('movieSettings', JSON.stringify(settings));
}

// CSS adjustments according to settings

function getAllCustomProperties() {
  const customProperties = [];
  for (const styleSheet of document.styleSheets) {
    try {
      const rules = styleSheet.cssRules || styleSheet.rules;
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          const declaration = rule.style;
          for (let i = 0; i < declaration.length; i++) {
            const property = declaration[i];
            if (property.startsWith('--') && !customProperties.includes(property)) {
              customProperties.push(property);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error while reading CSS rules:', error);
    }
  }
  return customProperties;
}

function getFontSizeProperties() {
  let customProperties = getAllCustomProperties();
  let fontSizeProperties = {};
  customProperties.filter(property => property.startsWith('--jellix-') && property.endsWith('font-size')).forEach(property => {
    let value = getComputedStyle(document.documentElement).getPropertyValue(property);
    const match = value.match(/(\d+(\.\d+)?)(\S+)/);
    fontSizeProperties[property] = {
      value: parseFloat(match[1]),
      unit: match[3]
    };
  });
  return fontSizeProperties;
}

const fontSizeProperties = getFontSizeProperties();

function changeFontSize(percent=null) {
  if (percent === null)
    percent = settings.fontSize;
  Object.entries(fontSizeProperties).forEach(([property, size]) => {
    // Calculate new font sizes
    const newSize = size.value * (percent / 100);
    // Update CSS custom properties with new font sizes
    document.documentElement.style.setProperty(property, newSize + size.unit);
  });
}

changeFontSize();

const logoutButton = document.querySelector('#logout-button');
logoutButton.addEventListener('click', logout);

// Check access token, redirect to login or initialise page
if (accessToken) {
  verifyToken(accessToken, data => {
    user = data;
    refreshMovies();
  },
  errorMessage => {
    window.location.href = '/login.html';
  });
} else {
  window.location.href = '/login.html';
}

function displayErrorMessage(error) {
  document.querySelector('.errors').textContent = error;
}

// Show loading screen
function showLoadingScreen() {
  const loadingScreen = document.querySelector('.loading-screen');
  loadingScreen.style.opacity = '1';
  loadingScreen.style.pointerEvents = 'auto'; // Enable clicks on the loading screen
}

// Hide loading screen
function hideLoadingScreen() {
  const loadingScreen = document.querySelector('.loading-screen');
  loadingScreen.style.opacity = '0';
  loadingScreen.style.pointerEvents = 'none'; // Disable interactions with the loading screen
}

function refreshMovies() {
  listsIdx = 0;
  document.querySelectorAll('.thumbnails-group').forEach(x => x.remove());
  getTranslation().then((data) => {
    translation = data;
    return getMovies();
  }).then(data => {
    processMovies(data.items);
    allMovies = data.items.reduce((obj, movie) => (obj[movie.Id] = movie, obj), {});
    createLists(data.items);
    populateMovies();
    hideLoadingScreen();
  })
  .catch(error => {
    // Handle errors here
    displayErrorMessage(error.message);
    console.error('Error in getMovies:', error);
  });
}

async function getTranslation() {
  if (settings.lang) {
    let response = await fetch(`/translations/${settings.lang}.json`);
    if (!response) {
      throw new Error('Failed to fetch translation');
    }
    let translation = await response.json();
    return translation;
  }
  return;
}

async function getMovies() {
  const headers = {'Authorization': `MediaBrowser Client="${client}", Device="${device}", DeviceId="${device_id}", Version="${client_version}", Token="${accessToken}"`}
  try {
    let itemsResponse = await fetch(`${API_URL}Users/${user.Id}/Items`, {headers});
    if (!itemsResponse.ok) {
      throw new Error('Failed to fetch items');
    }
    let itemsData = await itemsResponse.json();
    let collectionId = itemsData.Items.find(x => x.CollectionType == 'movies').Id;
    if (!collectionId)
      throw new Error('Failed to find movies collection');
    itemsResponse = await fetch(`${API_URL}Users/${user.Id}/Items?` + new URLSearchParams({
      'ParentId': collectionId,
      'fields': 'Genres,Tags,DateCreated,Overview,RemoteTrailers', // OriginalTitle,ProductionLocations,ExternalUrls,DateLastMediaAdded,SortName
      'enableImages': true,
      'IncludeItemTypes': 'Movie',
      'Recursive': true,
    }), {headers});
    if (!itemsResponse.ok) {
      throw new Error('Failed to fetch collection items');
    }
    itemsData = await itemsResponse.json();
    return {
      items: itemsData.Items,
    };
  } catch (error) {
    console.error('Error:', error.message);
    displayErrorMessage(error.message);
    // Handle the error here or re-throw to handle it in the calling context
    throw error;
  }
}

function processMovies(movies) {
  movies.forEach(movie => {
    if (movie.RunTimeTicks) {
      movie.durationSeconds = ticksToSeconds(movie.RunTimeTicks);
      movie.durationHuman = formatDuration(movie.durationSeconds);
    }
  });
}

function createLists(movies) {
  movies.sort((a, b) => a.Id.localeCompare(b.Id));
  lists = [];
  let i = 0;
  lists.push({
    idx: i++,
    name: 'Today\'s picks',
    movies: filterList(shuffle(movies.map(movie => movie.Id), seed)),
  });
  let latest = filterList(movies.map(movie => movie.Id).sort((a, b) => new Date(allMovies[b].DateCreated) - new Date(allMovies[a].DateCreated)));
  lists.push({idx: i++, name: 'Latest movies', movies: latest});
  let newest = filterList(movies.filter(x => x.PremiereDate).map(movie => movie.Id).sort((a, b) => new Date(allMovies[b].PremiereDate) - new Date(allMovies[a].PremiereDate)));
  lists.push({idx: i++, name: 'Newest movies', movies: newest});
  let favourites = filterList(movies.filter(x => x.UserData.IsFavorite).map(movie => movie.Id));
  if (favourites.length)
    lists.push({idx: i++, name: 'Favourites', movies: favourites});
  let allGenres = [...new Set(movies.reduce((acc, movie) => acc.concat(movie.Genres), []))];
  let sortedGenres = sortArrayByAppearance(genresOrder, allGenres);
  sortedGenres.forEach(genre => {
    let filtered = filterList(shuffle(movies.filter(movie => movie.Genres.includes(genre)).map(movie => movie.Id), seed));
    if (filtered.length) {
      lists.push({
        idx: i++,
        name: genre,
        movies: filtered,
      });
    }
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

function createThumbnailSlide(movie) {
  const imageTag = movie.ImageTags.Primary;
  const imageUrl = `${API_URL}Items/${movie.Id}/Images/Primary?fillHeight=608&fillWidth=406&quality=96&tag=${imageTag}`;
  const thumbnail = document.createElement('div');
  const thumbnailImage = document.createElement('div');
  thumbnailImage.style.backgroundImage = `url(${imageUrl})`;
  thumbnail.appendChild(thumbnailImage);
  thumbnail.alt = movie.Name;
  thumbnail.classList.add('movie-thumbnail');
  thumbnail.dataset.movieId = movie.Id; // Store the movie ID in a data attribute
  thumbnail.addEventListener('click', function() {
    displayMovieInfo(movie, thumbnail);
  });
  const thumbnailSlide = document.createElement('div');
  thumbnailSlide.classList.add('swiper-slide');
  thumbnailSlide.dataset.id = movie.Id;
  thumbnailSlide.appendChild(thumbnail);
  return thumbnailSlide;
}

function displayMovieInfo(movie, thumbnail) {
  console.log(`Displaying ${movie.Name}`);
  document.querySelectorAll('.movie-selected').forEach(x => x.classList.remove('movie-selected'));
  thumbnail.classList.add('movie-selected');
  // Find the elements for the backdrop and logo images
  const backgroundElement = document.querySelector('.background-container');
  const logoImageElement = document.querySelector('.feature-movie-logo');
  
  // Find the elements for the title and overview
  const titleElement = document.querySelector('.movie-title');
  const overviewElement = document.querySelector('.movie-overview');
  const playElement = document.querySelector('.play-button');

  // Set the backdrop and logo images if available
  const backdropImageTag = movie.BackdropImageTags && movie.BackdropImageTags[0];
  const logoImageTag = movie.ImageTags.Logo;
  const backdropImageUrl = backdropImageTag ? `${API_URL}Items/${movie.Id}/Images/Backdrop?fillWidth=960&fillHeight=840&quality=96&tag=${backdropImageTag}` : '';
  const logoImageUrl = logoImageTag ? `${API_URL}Items/${movie.Id}/Images/Logo?fillWidth=640&fillHeight=360&quality=96&tag=${logoImageTag}` : '';
  const playUrl = `${API_URL}web/index.html#!/details?id=${movie.Id}&serverId=${movie.ServerId}`;

  playElement.href = playUrl;

  // Update the src attributes for the images
  backgroundElement.style.backgroundImage = `url(${backdropImageUrl})`;
  
  if (!logoImageTag) {
    // If logo image doesn't exist, display the title
    titleElement.textContent = movie.Name;
    // Show the title and hide the logo image
    titleElement.style.display = 'block';
    logoImageElement.style.display = 'none';
  } else {
    // If logo image exists, hide the title and display the logo image
    logoImageElement.src = logoImageUrl;
    titleElement.style.display = 'none';
    logoImageElement.style.display = 'block';
  }
  // Update the text content for the title and overview
  if (translation && movie.Id in translation.movies) {
    titleElement.textContent = translation.movies[movie.Id].title;
    overviewElement.textContent = translation.movies[movie.Id].description;
  } else {
    titleElement.textContent = movie.Name;
    overviewElement.textContent = movie.Overview;
  }

  clearPlayer();
  if (movie.RemoteTrailers.length && settings.trailer_timer !== null) {
    playVideo(movie.RemoteTrailers[0].Url);
  }

  const productionYearElement = document.querySelector('.production-year');
  const communityRatingsElement = document.querySelector('.community-rating');
  const criticRatingsElement = document.querySelector('.critic-rating');
  const genresElement = document.querySelector('.genres');
  const durationElement = document.querySelector('.duration');

  productionYearElement.textContent = `${movie.ProductionYear}`;
  if (movie.CommunityRating) {
    communityRatingsElement.textContent = `${movie.CommunityRating}`;
    communityRatingsElement.style.display = '';
  } else {
    communityRatingsElement.style.display = 'none';
  }
  if (movie.CriticRating) {
    criticRatingsElement.textContent = `${movie.CriticRating}`;
    criticRatingsElement.style.display = '';
  } else {
    criticRatingsElement.style.display = 'none';
  }
  if (translation)
    genresElement.textContent = `${movie.Genres.map(genre => translation.interface.genres[genre] || genre).join(', ')}`;
  else
    genresElement.textContent = `${movie.Genres.join(', ')}`;
  durationElement.textContent = `${movie.durationHuman}`;
}

// Function to initialize movie thumbnails
function populateMovies() {
  let displayedIds = [... document.querySelectorAll('.thumbnails-group')].map(x => parseInt(x.dataset.idx));
  lists.slice(listsIdx, listsIdx + 2).forEach((list, i) => {
    if (displayedIds.includes(list.idx))
      return;
    const movieIds = list.movies;
    const title = list.name;
    const thumbnailsGroup = document.createElement('div');
    thumbnailsGroup.dataset.idx = list.idx;
    thumbnailsGroup.classList.add('thumbnails-group');
    thumbnailsGroup.innerHTML = `
      <div class="thumbnails-title"></div>
      <div class="thumbnails" id="movie-thumbnails">
        <div class="swiper">
          <div class="swiper-wrapper"></div>
        </div>
      </div>
    `;
    const titleElement = thumbnailsGroup.querySelector('.thumbnails-title');
    const movieThumbnailsContainer = thumbnailsGroup.querySelector('.swiper-wrapper');
    titleElement.textContent = title + ':';
    movieIds.forEach((movieId, i) => {
      if (i >= moviesSliderStartCount)
        return;
      const movie = allMovies[movieId];
      const thumbnailSlide = createThumbnailSlide(movie);
      movieThumbnailsContainer.appendChild(thumbnailSlide);
    });
    thumbnailsGroup.style.display = 'none';
    if (displayedIds.length && list.idx < Math.min(... displayedIds)) {
      parentContainer.insertBefore(thumbnailsGroup, parentContainer.firstChild);
    } else {
      parentContainer.appendChild(thumbnailsGroup);
    }
    displayedIds.push(list.idx);
  });
  let flag = false;
  if (displayedIds.length == 2) {
    document.querySelectorAll('.thumbnails-group').forEach(x => x.style.display = '');
    parentContainer.style.height = `${parentContainer.offsetHeight + 1}px`;
    flag = true;
  } else if (listsIdx == Math.min(... displayedIds) || (listsIdx == lists.length - 2 && displayedIds.length == 2)) {
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
  if (!flag || listsIdx == lists.length - 1) {
    const collapseGroup = document.querySelector('.thumbnails-group');
    if (collapseGroup) {
      collapseGroup.style.marginTop = `calc(-${collapseGroup.offsetHeight}px - ${getComputedStyle(collapseGroup).marginBottom})`;
      document.querySelectorAll('.thumbnails-group').forEach(x => x.style.display = '');
      setTimeout(() => {
        collapseGroup.remove();
      }, 100);
    }
  }
  const swiperEl = [... document.querySelectorAll('.thumbnails-group')].find(x => x.dataset.idx == listsIdx).querySelector('.swiper');
  activeSwiper = swiperEl.swiper;
  if (activeSwiper === undefined) {
    const swiper = new Swiper(swiperEl, {
      direction: 'horizontal',
      loop: false,
      initialSlide: 0,
      slidesPerView: 'auto',
      on: {
        sliderMove: updateSwiper,
        slideChange: updateSwiper,
      }
    });
    swiper.jx_last_list_idx = moviesSliderStartCount - 1;
    activeSwiper = swiper;
  } else {
    activeSwiper.slideTo(0);
  }
  let activeList = lists.find(x => x.idx == listsIdx);
  displayMovieInfo(allMovies[activeList.movies[0]], [... document.querySelectorAll('.thumbnails-group')].find(x => x.dataset.idx == listsIdx).querySelector('.movie-thumbnail'));
  slideIdx = 0;
}

function updateSwiper(swiper) {
  if (swiper.progress > 0.8 && swiper.jx_last_list_idx < lists[listsIdx].movies.length - 1) {
    swiper.jx_last_list_idx++;
    const movieId = lists[listsIdx].movies[swiper.jx_last_list_idx];
    const movie = allMovies[movieId];
    const thumbnailSlide = createThumbnailSlide(movie);
    swiper.appendSlide(thumbnailSlide);
    swiper.update();
  }
}

function handleRightAction() {
  let activeList = lists.find(x => x.idx == listsIdx);
  let movieIds = activeList.movies;
  if (slideIdx + 1 < movieIds.length) {
    slideIdx++;
    let movie = allMovies[movieIds[slideIdx]];
    let slide = activeSwiper.slides.find(x => x.dataset.id == movie.Id);
    displayMovieInfo(movie, slide.querySelector('.movie-thumbnail'));
    if (!activeSwiper.isEnd)
      activeSwiper.slideNext();
  }
}

function handleLeftAction() {
  let activeList = lists.find(x => x.idx == listsIdx);
  let movieIds = activeList.movies;
  if (slideIdx) {
    slideIdx--;
    let movie = allMovies[movieIds[slideIdx]];
    let slide = activeSwiper.slides.find(x => x.dataset.id == movie.Id);
    displayMovieInfo(movie, slide.querySelector('.movie-thumbnail'));
    if (!activeSwiper.isBeginning)
      activeSwiper.slidePrev();
  }
}

function handleUpAction() {
  if (listsIdx) {
    listsIdx--;
    populateMovies();
  }
}

function handleDownAction() {
  if (lists.length > listsIdx + 1) {
    listsIdx++;
    populateMovies();
  }
}

function handleEnterAction() {
  const playElement = document.querySelector('.play-button');
  playElement.click();
}

let canFire = true;

function cooldown() {
  canFire = false;
  setTimeout(() => {
    canFire = true;
  }, 300);
}

// Event listener for mouse wheel
document.addEventListener('wheel', (event) => {
  if (canFire) {
    if (event.deltaY < 0) {
      handleUpAction();
    } else {
      handleDownAction();
    }
    cooldown();
  }
});

// Event listener for keyboard keys
document.addEventListener('keydown', (event) => {
  if (canFire) {
    if (event.key === 'ArrowUp') {
      handleUpAction();
    } else if (event.key === 'ArrowDown') {
      handleDownAction();
    } else if (event.key === 'ArrowRight') {
      handleRightAction();
    } else if (event.key === 'ArrowLeft') {
      handleLeftAction();
    } else if (event.key === 'Enter') {
      handleEnterAction();
    }
    cooldown();
  }
});

document.getElementById('nav-up').addEventListener('click', handleUpAction);
document.getElementById('nav-down').addEventListener('click', handleDownAction);
document.getElementById('nav-left').addEventListener('click', handleLeftAction);
document.getElementById('nav-right').addEventListener('click', handleRightAction);

// Youtube trailers
var fadeTimeout;  // To store the current timeout reference
var checkPlayerTimeout;
var checkVideoEndInterval;
var player;  // Store the YouTube player instance
var trailerControlState;
var activeVideoId; // Store the ID of the video that should be playing
const playerContainer = document.getElementById('player-container');
const trailerControl = document.querySelector('#trailer-control');

// Function called by the YouTube API when it's ready
function onYouTubeIframeAPIReady() {
  console.log('YouTube Iframe API Ready');
  const origin = window.location.origin;
  player = new YT.Player('youtube-player', {
    playerVars: {
      rel: 0,              // Disable related videos
      autoplay: 1,         // Autoplay the video
      loop: 1,             // Enable looping
      controls: 0,         // Display controls
      origin: origin,
    },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onAutoplayBlocked': onPlayerAutoplayBlocked,
    }
  });
}

function onPlayerReady(event) {
  console.log('YouTube Player is ready.');
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    console.log('Video is playing:', player.videoTitle);
    if (player.getVideoData().video_id != activeVideoId) {
      console.log('Playing incorrect video, ignoring', player.getVideoData().video_id, activeVideoId);
      return;
    }
    playerContainer.classList.add('visible');
    player.unMute();
    trailerControl.textContent = 'Stop trailer';
    trailerControl.style.display = '';
    trailerControlState = 'stop';
    startCheckingVideoTime();  // Start checking video time when video starts playing
  } else if (event.data === YT.PlayerState.ENDED) {
    console.log('Video has ended.');
    clearInterval(checkVideoEndInterval);  // Clear interval when video ends
  } else if (event.data === YT.PlayerState.PAUSED) {
    clearInterval(checkVideoEndInterval);  // Stop checking if video is paused
  } else if (event.data === YT.PlayerState.UNSTARTED) {
    console.log('Player error')
    clearInterval(checkVideoEndInterval);
    hidePlayer();
  }
}

function onPlayerAutoplayBlocked() {
  console.log('Autoplay is blocked by the browser');
  hidePlayer();
}

// Fade out the video before it finishes
function startCheckingVideoTime() {
  checkVideoEndInterval = setInterval(() => {
    if (player && player.getDuration && player.getCurrentTime) {
      const duration = player.getDuration();  // Get the video duration
      const currentTime = player.getCurrentTime();  // Get the current time
      if (duration - currentTime <= 1) {
        clearInterval(checkVideoEndInterval);  // Stop the interval when the condition is met
        hidePlayer();
      }
    }
  }, 50);
}

function hidePlayer() {
  console.log('Hiding player');
  playerContainer.classList.remove('visible');
  trailerControl.style.display = 'none';
}

function playVideo(url) {
  const checkPlayerReady = () => {
    if (player && player.hasOwnProperty('loadVideoById')) {
      // Player is ready, execute the video play logic
      console.log('Loading trailer', url);
      
      // Extract the video ID from the URL
      const videoId = url.split('v=')[1] || url.split('/').pop();
      const ampersandPosition = videoId.indexOf('&');
      const finalVideoId = ampersandPosition !== -1 ? videoId.substring(0, ampersandPosition) : videoId;

      // Set a timeout to wait for settings.trailer_timer seconds before showing the player and playing the video
      fadeTimeout = setTimeout(() => {
        activeVideoId = finalVideoId;
        player.loadVideoById(finalVideoId);
      }, settings.trailer_timer * 1000);
    } else {
      // Player is not ready yet, retry after 10ms
      checkPlayerTimeout = setTimeout(checkPlayerReady, 10);
    }
  };

  // Start checking if the player is ready
  checkPlayerReady();
}

function clearPlayer() {
  activeVideoId = null;
  // Clear any existing timeouts to ensure only the latest call is processed
  if (checkPlayerTimeout)
    clearTimeout(checkPlayerTimeout);
  if (fadeTimeout)
    clearTimeout(fadeTimeout);
  // Hide the player container
  hidePlayer();
  // Mute the video in case one was already playing
  if (player && player.hasOwnProperty('mute')) {
    player.mute();
  }
}

trailerControl.addEventListener('click', () => {
  if (player) {
    if (trailerControlState == 'stop') {
      player.mute();
      playerContainer.classList.remove('visible');
      trailerControl.textContent = 'Disable trailers';
      trailerControlState = 'disable';
    } else if (trailerControlState == 'disable') {
      settings.trailer_timer = null;
      trailerControl.style.display = 'none';
    }
  }
})

// Settings

const settingsButton = document.getElementById('settings-button');
const overlay = document.getElementById('overlay');
const settingsSaveButton = document.querySelector('.settings-save');
const fontSizeInput = document.querySelector('#setting-font-size');

settingsButton.addEventListener('click', () => {
  overlay.classList.add('show');
});

settingsSaveButton.addEventListener('click', () => {
  overlay.classList.remove('show');
});

fontSizeInput.addEventListener('change', () => {
  changeFontSize(parseInt(fontSizeInput.value));
});

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
  document.getElementById('setting-trailer-timer').value = settings.trailer_timer || '';
  document.getElementById('indicator-unplayed-filter').style.display = settings.filterHidePlayed ? '' : 'none';
  if (settings.filterYearMin && settings.filterYearMin > 1900 || settings.filterYearMax) {
    let filterYearMin = settings.filterYearMin;
    if (filterYearMin == 1900)
      filterYearMin = null;
    let filterYearMax = settings.filterYearMax;
    let yearRange = '';
    if (filterYearMin && filterYearMax)
      yearRange = `${filterYearMin}-${filterYearMax}`;
    else if (filterYearMin)
      yearRange = `${filterYearMin}+`;
    else if (filterYearMax)
      yearRange = `-${filterYearMax}`;
    const formattedYearRange = yearRange.replace(/^(-\d+)-\+$/, '$1+');
    document.getElementById('indicator-year-filter').style.display = '';
    document.getElementById('indicator-year-filter').textContent = formattedYearRange;
  } else {
    document.getElementById('indicator-year-filter').style.display = 'none';
  }
  document.getElementById('indicator-community-rating-filter').style.display = settings.filterCommunityRatingsMin ? '' : 'none';
  document.getElementById('indicator-community-rating-filter').textContent = settings.filterCommunityRatingsMin + '+';
  document.getElementById('indicator-critic-rating-filter').style.display = settings.filterCriticRatingsMin ? '' : 'none';
  document.getElementById('indicator-critic-rating-filter').textContent = settings.filterCriticRatingsMin + '+';
  document.getElementById('indicator-runtime-minutes-filter').style.display = settings.filterRuntimeMinutes ? '' : 'none';
  document.getElementById('indicator-runtime-minutes-filter').textContent = settings.filterRuntimeMinutes + 'm+';
  const hasFilters = [... document.querySelectorAll('.filter-indicators > span')].find(x => x.style.display != 'none');
  document.querySelector('.filter-indicators').style.display = hasFilters ? '' : 'none';
  const navButtons = document.getElementById('nav-buttons');
  if (settings.showNav) {
    navButtons.style.display = 'block';
  } else {
    navButtons.style.display = 'none';
  }
  const translationsContainer = document.getElementById('setting-translations-container');
  const translationsSelect = document.getElementById('setting-translations');
  if (TRANSLATIONS && TRANSLATIONS.trim() !== '') {
    translationsContainer.style.display = 'block';
    const translationsArray = TRANSLATIONS.split(',').map(item => item.trim());
    const existingOptions = Array.from(translationsSelect.options).map(option => option.value);
    translationsArray.forEach(translation => {
      if (!existingOptions.includes(translation)) {
        const newOption = document.createElement('option');
        newOption.value = translation;
        newOption.text = translation;
        translationsSelect.appendChild(newOption);
      }
    });
    translationsSelect.value = settings.lang || '';
    if (settings.lang == 'he' || settings.lang === 'ar') {
      document.body.classList.add('rtl');
    } else {
      document.body.classList.remove('rtl');
    }
  } else {
    translationsContainer.style.display = 'none';
  }
  if (settings.trailer_timer === null) {
    if (player && player.hasOwnProperty('mute'))
      player.mute();
    hidePlayer();
  }
}

document.querySelector('.settings-save').addEventListener('click', function() {
  settings.showNav = document.getElementById('setting-show-nav').checked;
  settings.filterHidePlayed = document.getElementById('filter-hide-played').checked;
  settings.filterYearMin = parseInt(document.getElementById('filter-year-min').value) || 1900;
  settings.filterYearMax = parseInt(document.getElementById('filter-year-max').value);
  settings.filterCommunityRatingsMin = parseFloat(document.getElementById('filter-community-ratings-min').value) || 0;
  settings.filterCriticRatingsMin = parseInt(document.getElementById('filter-critic-ratings-min').value) || 0;
  settings.filterRuntimeMinutes = parseInt(document.getElementById('filter-runtime-minutes').value) || 0;
  settings.fontSize = parseInt(document.getElementById('setting-font-size').value) || 100;
  settings.lang = document.getElementById('setting-translations').value;
  settings.trailer_timer = parseFloat(document.getElementById('setting-trailer-timer').value) || null;
  saveSettings();
  initializeSettings();
  showLoadingScreen();
  refreshMovies();
});

initializeSettings();
