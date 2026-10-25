import RFB from './vendor/novnc/core/rfb.js';

const $ = id => document.getElementById(id);
let rfb = null;
let configured = false;
let autoAuth = false;
let registered = false;
let connected = false;
let controlling = false;
let credentialTypes = [];
let connectTimer;
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function buttons() {
  $('connect').disabled = !configured || !!rfb || (autoAuth && !registered);
  $('disconnect').disabled = !rfb;
  $('control').disabled = !connected;
  $('fullscreen').disabled = !connected || !document.fullscreenEnabled;
  $('control').setAttribute('aria-pressed', String(controlling));
  $('control').textContent = controlling ? '操作を停止' : '操作を開始';
}
function clearCredentials() {
  $('password').value = '';
  $('username').value = '';
  if ($('credentials').open) $('credentials').close();
}
function reset() {
  clearTimeout(connectTimer);
  clearCredentials();
  connected = false;
  controlling = false;
  $('empty').hidden = false;
  $('empty').querySelector('p').textContent = '「接続する」で画面を表示します。';
  $('status').textContent = '未接続';
  $('hint').textContent = '接続後は画面を見るだけです。「操作を開始」でマウスとキーボードを使えます。';
  buttons();
}
function disconnect() {
  const previous = rfb;
  rfb = null;
  previous?.disconnect();
  reset();
}
$('connect').addEventListener('click', () => {
  error();
  const url = new URL('./ws', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    const current = new RFB($('screen'), url.href, { shared: true });
    rfb = current;
    rfb.viewOnly = true;
    rfb.scaleViewport = $('fit').checked;
    rfb.resizeSession = false;
    $('status').textContent = '接続中';
    $('empty').hidden = true;
    buttons();
    connectTimer = setTimeout(() => {
      if (rfb === current) { disconnect(); error('接続がタイムアウトしました。接続先の設定を確認してください。'); }
    }, 90_000);
    current.addEventListener('connect', () => {
      if (rfb !== current) return;
      clearTimeout(connectTimer);
      connected = true;
      $('status').textContent = '接続中・入力停止';
      buttons();
    });
    current.addEventListener('disconnect', event => {
      if (rfb !== current) return;
      rfb = null;
      reset();
      if (!event.detail.clean) error('接続できないか、接続が切れました。VNCの起動・認証・他の接続を確認して再接続してください。');
    });
    current.addEventListener('securityfailure', () => {
      if (rfb === current) error('接続先の認証に失敗しました。設定を確認して再接続してください。');
    });
    current.addEventListener('credentialsrequired', event => {
      if (rfb !== current) return;
      credentialTypes = event.detail.types;
      if (credentialTypes.some(type => !['username', 'password'].includes(type))) {
        disconnect(); error('この認証方式は初版では対応していません。'); return;
      }
      $('username-label').hidden = !credentialTypes.includes('username');
      $('password-label').hidden = !credentialTypes.includes('password');
      $('credentials').showModal();
      (credentialTypes.includes('username') ? $('username') : $('password')).focus();
    });
    current.addEventListener('serververification', () => {
      if (rfb === current) { disconnect(); error('サーバー証明書の確認が必要な認証方式は、初版では対応していません。'); }
    });
  } catch {
    disconnect(); error('ビューアーを起動できません。対応ブラウザとHTTPSまたはlocalhost接続を確認してください。');
  }
});
$('disconnect').addEventListener('click', disconnect);
$('control').addEventListener('click', () => {
  if (!connected || !rfb) return;
  controlling = !controlling;
  rfb.viewOnly = !controlling;
  $('status').textContent = controlling ? '接続中・操作中' : '接続中・入力停止';
  $('hint').textContent = controlling ? '画面をクリックして操作します。操作を終えたら「操作を停止」または「切断」を押してください。' : '画面を閲覧しています。マウスとキーボードの入力は停止中です。';
  buttons();
});
$('fit').addEventListener('change', () => { if (rfb) rfb.scaleViewport = $('fit').checked; });
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('desktop').requestFullscreen(); }
  catch { error('このブラウザでは全画面にできません。'); }
});
$('credential-form').addEventListener('submit', event => {
  event.preventDefault();
  const credentials = {};
  for (const type of credentialTypes) credentials[type] = $(type).value;
  rfb?.sendCredentials(credentials);
  clearCredentials();
});
$('cancel').addEventListener('click', disconnect);
$('credentials').addEventListener('cancel', event => { event.preventDefault(); disconnect(); });
window.addEventListener('pagehide', disconnect);
async function refreshStatus() {
try {
  const response = await fetch('./api/status');
  if (!response.ok) throw new Error('Unavailable');
  const state = await response.json();
  configured = state.configured; autoAuth = state.autoAuth; registered = state.registered;
  $('registration').hidden = !autoAuth || registered;
  $('forget').hidden = !autoAuth || !registered;
  $('status').textContent = configured ? '未接続' : 'セットアップが必要です';
  $('empty').querySelector('p').textContent = configured ? '「接続する」で画面を表示します。' : 'PC側の画面共有と接続先ポートを設定してください。手順はリポジトリのXANGI_SETUP.mdにあります。';
  buttons();
} catch { $('status').textContent = '接続状態を取得できません'; error('xangiの拡張画面から開き直してください。'); }

}
$('registration-form').addEventListener('submit', async event => {
  event.preventDefault(); error();
  const code = $('registration-code').value.trim(); $('registration-code').value = '';
  try {
    const response = await fetch('./api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, permanent: $('registration-permanent').checked }) });
    if (!response.ok) { error(response.status === 429 ? '登録を試しすぎました。1分後に再試行してください。' : '登録コードを確認してください。'); return; }
    await refreshStatus();
    if (!registered) error('登録を保存できません。Cookieを許可し、HTTPSなど指定された接続先を使ってください。');
  } catch { error('登録に失敗しました。再試行してください。'); }
});
$('forget').addEventListener('click', async () => {
  disconnect();
  try {
    const response = await fetch('./api/forget', { method: 'POST' });
    if (!response.ok) throw Error();
    await refreshStatus();
  } catch { error('登録解除に失敗しました。再試行してください。'); }
});
await refreshStatus();
