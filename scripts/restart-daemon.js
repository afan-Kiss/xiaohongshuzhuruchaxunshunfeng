#!/usr/bin/env node
/** 重启 CDP 注入守护并强制重新注入最新侧栏 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = path.join(ROOT, '.inject-daemon.lock');

function killOldDaemon() {
  if (!fs.existsSync(LOCK_PATH)) return;
  try {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    if (pid > 0) {
      process.kill(pid, 'SIGTERM');
      console.log('[restart] 已停止旧守护进程 PID=', pid);
    }
  } catch (err) {
    if (err.code !== 'ESRCH') console.warn('[restart] 停止旧进程:', err.message);
  }
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
}

function spawnHidden(args, label) {
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: ROOT,
  });
  child.unref();
  if (label) console.log(label, child.pid);
  return child;
}

killOldDaemon();
setTimeout(() => {
  spawnHidden([path.join(ROOT, 'src', 'auto-inject.js')], '[restart] 新守护进程已启动 PID=');
}, 800);
