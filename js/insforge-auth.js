const insforgeClient = InsForge.insforge;

let _currentUser = null;
let _authListeners = [];

async function initAuth() {
  try {
    const { data } = await insforgeClient.auth.getCurrentUser();
    if (data?.user) {
      _currentUser = data.user;
    }
  } catch (e) {
    const saved = sessionStorage.getItem('aac_if_user');
    if (saved) {
      try { _currentUser = JSON.parse(saved); } catch(ee) {}
    }
  }
  _notifyListeners();
  return _currentUser;
}

function getUser() {
  return _currentUser;
}

function onAuthChange(fn) {
  _authListeners.push(fn);
  return () => { _authListeners = _authListeners.filter(l => l !== fn); };
}

function _notifyListeners() {
  _authListeners.forEach(fn => { try { fn(_currentUser); } catch(e) {} });
}

async function signUp(email, password, name) {
  const { data, error } = await insforgeClient.auth.signUp({
    email, password, name,
    redirectTo: window.location.origin + '/'
  });
  if (error) throw error;
  if (data?.accessToken) {
    _currentUser = data.user;
    _notifyListeners();
  }
  return data;
}

async function signIn(email, password) {
  const { data, error } = await insforgeClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data) {
    _currentUser = data.user;
    try { sessionStorage.setItem('aac_if_user', JSON.stringify(data.user)); } catch(e) {}
    _notifyListeners();
  }
  return data;
}

async function signOut() {
  await insforgeClient.auth.signOut();
  _currentUser = null;
  try { sessionStorage.removeItem('aac_if_user'); } catch(e) {}
  _notifyListeners();
}

function renderAuthUI(container) {
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;background:var(--bg)">
      <div style="max-width:400px;width:100%">
        <div style="text-align:center;margin-bottom:24px">
          <img src="img/logo.jpg" alt="AACTS" style="width:80px;height:80px;border-radius:50%;margin-bottom:8px;object-fit:cover;border:2px solid var(--border)">
          <h1 style="font-size:22px;margin:0">AAC Technical Services</h1>
          <p class="text-muted" style="margin-top:4px" id="auth-subtitle">Sign in with your email</p>
        </div>
        <div class="card" style="padding:20px">
          <div id="auth-error" class="text-red small" style="display:none;margin-bottom:8px"></div>
          <div id="auth-form">
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="auth-email" class="form-input" placeholder="you@example.com" autocomplete="email">
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" id="auth-password" class="form-input" placeholder="Password" autocomplete="current-password">
            </div>
            <button class="btn btn-primary btn-block" id="auth-signin-btn">Sign In</button>
            <button class="btn btn-secondary btn-block" id="auth-show-signup-btn" style="margin-top:8px">Create Account</button>
          </div>
          <div id="auth-signup-form" style="display:none">
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" id="auth-signup-name" class="form-input" placeholder="Your name">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="auth-signup-email" class="form-input" placeholder="you@example.com">
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" id="auth-signup-password" class="form-input" placeholder="At least 6 characters">
            </div>
            <button class="btn btn-primary btn-block" id="auth-signup-btn">Create Account</button>
            <button class="btn btn-secondary btn-block" id="auth-back-btn" style="margin-top:8px">Back to Sign In</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const errorEl = document.getElementById('auth-error');
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = '';
  }
  function hideError() { errorEl.style.display = 'none'; }

  document.getElementById('auth-signin-btn').addEventListener('click', async () => {
    hideError();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) { showError('Email and password required'); return; }
    document.getElementById('auth-signin-btn').disabled = true;
    document.getElementById('auth-signin-btn').textContent = 'Signing in...';
    try {
      await signIn(email, password);
      return true;
    } catch (e) {
      showError(e.message || 'Sign in failed');
      document.getElementById('auth-signin-btn').disabled = false;
      document.getElementById('auth-signin-btn').textContent = 'Sign In';
    }
  });

  document.getElementById('auth-show-signup-btn').addEventListener('click', () => {
    hideError();
    document.getElementById('auth-form').style.display = 'none';
    document.getElementById('auth-signup-form').style.display = '';
    document.getElementById('auth-subtitle').textContent = 'Create a new account';
  });

  document.getElementById('auth-back-btn').addEventListener('click', () => {
    hideError();
    document.getElementById('auth-signup-form').style.display = 'none';
    document.getElementById('auth-form').style.display = '';
    document.getElementById('auth-subtitle').textContent = 'Sign in with your email';
  });

  document.getElementById('auth-signup-btn').addEventListener('click', async () => {
    hideError();
    const name = document.getElementById('auth-signup-name').value.trim();
    const email = document.getElementById('auth-signup-email').value.trim();
    const password = document.getElementById('auth-signup-password').value;
    if (!name) { showError('Name is required'); return; }
    if (!email || !password) { showError('Email and password required'); return; }
    if (password.length < 6) { showError('Password must be at least 6 characters'); return; }
    document.getElementById('auth-signup-btn').disabled = true;
    document.getElementById('auth-signup-btn').textContent = 'Creating account...';
    try {
      const result = await signUp(email, password, name);
      if (result?.requireEmailVerification) {
        showError('Please check your email to verify your account, then sign in.');
        document.getElementById('auth-signup-btn').disabled = false;
        document.getElementById('auth-signup-btn').textContent = 'Create Account';
        document.getElementById('auth-back-btn').click();
      } else {
        return true;
      }
    } catch (e) {
      showError(e.message || 'Sign up failed');
      document.getElementById('auth-signup-btn').disabled = false;
      document.getElementById('auth-signup-btn').textContent = 'Create Account';
    }
  });
}

async function onAuthReady() {
  return new Promise(resolve => {
    if (_currentUser) { resolve(_currentUser); return; }
    const unsub = onAuthChange(user => {
      if (user) { unsub(); resolve(user); }
    });
    setTimeout(() => { unsub(); resolve(null); }, 10000);
  });
}
