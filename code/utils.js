function shuffle(array, seed) {
  var m = array.length, t, i;
  while (m) {
    i = Math.floor(random(seed) * m--);
    t = array[m];
    array[m] = array[i];
    array[i] = t;
    ++seed;
  }
  return array;
}

function random(seed) {
  var x = Math.sin(seed++) * 10000; 
  return x - Math.floor(x);
}

function ticksToSeconds(ticks) {
  const ticksPerSecond = 10000000; // 10 million ticks per second
  return ticks / ticksPerSecond;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function sortArrayByAppearance(sortedArr, jumbledArr) {
  return jumbledArr.slice().sort((a, b) => {
    const aIndex = sortedArr.indexOf(a);
    const bIndex = sortedArr.indexOf(b);
  
    if (aIndex === -1 && bIndex === -1) {
      return a.localeCompare(b);
    } else if (aIndex === -1) {
      return 1;
    } else if (bIndex === -1) {
      return -1;
    }
  
    return aIndex - bIndex;
  });
}
