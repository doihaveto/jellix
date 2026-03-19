export const tokenKey = 'accessToken';
export const device = 'Device';
export const client = 'Jellix';
export const client_version = '0.0.1';

function generateRandomString(length) {
  return [...Array(length)].map(() => Math.random().toString(36)[2]).join('');
}

export let device_id = localStorage.getItem('deviceId');

if (!device_id) {
  device_id = generateRandomString(16);
  localStorage.setItem('deviceId', device_id);
}

export const accessToken = localStorage.getItem(tokenKey);

export function getAuthHeader(token = null) {
  let header = `MediaBrowser Client="${client}", Device="${device}", DeviceId="${device_id}", Version="${client_version}"`;
  if (token) header += `, Token="${token}"`;
  return header;
}

export function verifyToken(token, onSuccess, onError) {
  fetch(`${API_URL}Users/Me`, {
    method: 'GET',
    headers: { 'Authorization': getAuthHeader(token) },
  })
  .then(response => {
    if (response.ok) return response.json();
    throw new Error('Token verification failed');
  })
  .then(data => onSuccess(data))
  .catch(error => {
    localStorage.removeItem(tokenKey);
    onError(error.message);
  });
}

export function logout() {
  localStorage.removeItem(tokenKey);
  window.location.href = '/login.html';
}
