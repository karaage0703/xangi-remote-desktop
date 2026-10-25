import { loadEnvFile } from 'node:process';
import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readPrivateFile, loadSavedAuth } from '../src/browser-auth.mjs';
import { readConfig } from '../src/config.mjs';

const usage = `リポジトリのディレクトリで実行してください。
  npm run setup                 自動認証設定を検証し、登録コードを作成・表示
  npm run registration -- show  現在の登録コードを表示（変更しません）
  npm run registration -- rotate  登録コードを再発行
再発行後は拡張を停止・起動してください。既存接続と全ブラウザの登録は、その時点で無効になります。
コードはPCを操作する権限を与えます。本人の端末で確認し、必要な利用者へ個別に渡してください。`;
const command = process.argv[2];
async function main() {
  if (!command || ['--help', '-h'].includes(command)) { console.log(usage); return; }
  if (process.argv.length !== 3 || !['setup', 'show', 'rotate'].includes(command)) throw Error('コマンドを確認してください。\n' + usage);
  try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const path = process.env.REMOTE_DESKTOP_BROWSER_KEY_FILE;
  if (!process.env.REMOTE_DESKTOP_VNC_PASSWORD_FILE || !path) throw Error('先に.envのREMOTE_DESKTOP_VNC_PASSWORD_FILEとREMOTE_DESKTOP_BROWSER_KEY_FILEへ絶対パスを設定してください。手順: XANGI_SETUP.md');
  if (command === 'setup') {
    if (!readConfig().port) throw Error('先に.envのREMOTE_DESKTOP_VNC_PORTを設定してください。');
    await loadSavedAuth(process.env);
  }
  let key = await readPrivateFile(path);
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error('登録コードの形式が不正です。設定ファイルを確認してください。');
  if (command === 'rotate') {
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    key = randomBytes(32).toString('hex');
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(key + '\n'); await file.sync(); await file.close();
      await rename(temporary, path);
    } catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
    console.log('再発行しました。反映には拡張の停止・起動が必要です。全ブラウザで新しいコードによる再登録が必要になります。');
  }
  console.log(`登録コード（VNCパスワードではありません）:\n${key}\n\nxangiの「xangi-remote-desktop」→「このブラウザを登録」に入力してください。\n既定30日、希望する場合は「この端末を期限なしで登録」を選べます。\n管理者が導入する場合は、このコードを許可した利用者にだけ個別に渡してください。`);
  if (command === 'setup') console.log('設定の検証が完了しました。続いてXANGI_SETUP.mdの「xangiへ登録」を実行してください。VNCへの実接続はまだ確認していません。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
