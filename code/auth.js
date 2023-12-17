const tokenKey = 'accessToken';
const device = 'Device';
const client = 'Jellix';
const client_version = '0.0.1';
var device_id = localStorage.getItem('deviceId');

function generateRandomString(length) {
  return [...Array(length)].map(() => Math.random().toString(36)[2]).join('');
}

// Generate device ID
if (!device_id) {
  device_id = generateRandomString(16);
  localStorage.setItem('deviceId', device_id);
}

// Check if user is already logged in
const accessToken = localStorage.getItem(tokenKey);

function verifyToken(token, onSuccess, onError) {
  fetch(`${API_URL}Users/Me`, {
    method: 'GET',
    headers: {
      'Authorization': `MediaBrowser Client="${client}", Device="${device}", DeviceId="${device_id}", Version="${client_version}", Token="${token}"`
    }
  })
  .then(response => {
    if (response.ok) {
      return response.json();
    } else {
      throw new Error('Token verification failed');
    }
  })
  .then(data => {
    onSuccess(data); // Call success callback
  })
  .catch(error => {
    localStorage.removeItem(tokenKey); // Remove invalid token
    onError(error.message); // Call error callback
  });
}

// Function to reset token and redirect to login page
function logout() {
  localStorage.removeItem(tokenKey);
  window.location.href = '/login.html';
}
