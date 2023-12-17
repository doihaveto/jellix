function displayErrorMessage(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
}

if (accessToken) {
  verifyToken(accessToken, () => {
    // On success - redirect to index.html
    window.location.href = '/index.html';
  },
  errorMessage => {
    // On error - display error message
    displayErrorMessage(errorMessage);
  });
} else {
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', function(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    authenticate(username, password);
  });
}

function authenticate(username, password) {
  fetch(`${API_URL}Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `MediaBrowser Client="${client}", Device="${device}", DeviceId="${device_id}", Version="${client_version}"`,
    },
    body: JSON.stringify({
      Username: username,
      Pw: password
    })
  })
  .then(response => {
    if (response.ok) {
      return response.json();
    }
    throw new Error('Authentication failed');
  })
  .then(data => {
    const accessToken = data.AccessToken;
    if (accessToken) {
      localStorage.setItem(tokenKey, accessToken);
      window.location.href = '/index.html';
    } else {
      throw new Error('Access token not found');
    }
  })
  .catch(error => {
    displayErrorMessage(error.message);
  });
}
