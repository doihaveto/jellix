export function shuffle(array, seed) {
  const copy = [...array];
  seed = parseInt(seed);
  let m = copy.length, t, i;
  while (m) {
    i = Math.floor(random(seed) * m--);
    t = copy[m];
    copy[m] = copy[i];
    copy[i] = t;
    ++seed;
  }
  return copy;
}

function random(seed) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

export function ticksToSeconds(ticks) {
  const ticksPerSecond = 10000000; // 10 million ticks per second
  return ticks / ticksPerSecond;
}

export function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function sortArrayByAppearance(sortedArr, jumbledArr) {
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
