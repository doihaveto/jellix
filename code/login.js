import { accessToken, tokenKey, verifyToken, getAuthHeader } from './auth.js';

function displayErrorMessage(message) {
  document.getElementById('error').textContent = message;
}

if (accessToken) {
  verifyToken(accessToken, () => {
    window.location.href = '/index.html';
  },
    errorMessage => {
      displayErrorMessage(errorMessage);
    }
  );
} else {
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    const loginMethod = loginForm.login_method.value;
    const username = loginForm.username.value;
    const password = loginForm.password.value;
    const quickcodeSecret = loginForm.quickcode_secret.value;
    authenticate(loginMethod, username, password, quickcodeSecret);
  });
}

async function authenticate(loginMethod, username, password, quickcodeSecret) {
  let endpoint, body;
  if (loginMethod === 'username') {
    endpoint = 'AuthenticateByName';
    body = JSON.stringify({Username: username, Pw: password});
  } else if (loginMethod === 'quickcode') {
    endpoint = 'AuthenticateWithQuickConnect';
    body = JSON.stringify({Secret: quickcodeSecret});
  }
  try {
    const response = await fetch(`${API_URL}Users/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body,
    });
    if (!response.ok) throw new Error('Authentication failed');
    const data = await response.json();
    if (!data.AccessToken) throw new Error('Access token not found');
    localStorage.setItem(tokenKey, data.AccessToken);
    window.location.href = '/index.html';
  } catch (error) {
    displayErrorMessage(error.message);
  }
}

async function initializeQuickConnect() {
  try {
    const response = await fetch(`${API_URL}QuickConnect/Initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body: '',
    });
    if (!response.ok) throw new Error('Could not get QuickConnect code');
    const data = await response.json();
    document.getElementById('quickcode').value = data.Code;
    document.getElementById('quickcode_secret').value = data.Secret;
  } catch (error) {
    displayErrorMessage(error.message);
  }
}

function changeAuthenticationMethod(loginMethod) {
  if (loginMethod === 'username') {
    document.getElementById('auth-by-quickcode').style.display = 'none';
    document.getElementById('username').required = true;
    document.getElementById('password').required = true;
    document.getElementById('auth-by-credentials').style.display = 'block';
  } else if (loginMethod === 'quickcode') {
    const active = parseInt(document.getElementById('quickcode_status').value);
    if (!active) initializeQuickConnect();
    document.getElementById('quickcode_status').value = 1;
    document.getElementById('auth-by-credentials').style.display = 'none';
    document.getElementById('username').required = false;
    document.getElementById('password').required = false;
    document.getElementById('auth-by-quickcode').style.display = 'block';
  }
}

document.getElementById('username-method').addEventListener('change', function () {
  changeAuthenticationMethod(this.value);
  updateTabStyles();
});
document.getElementById('quickcode-method').addEventListener('change', function () {
  changeAuthenticationMethod(this.value);
  updateTabStyles();
});

function updateTabStyles() {
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.classList.toggle('login-tab-active', tab.querySelector('input').checked);
  });
}
