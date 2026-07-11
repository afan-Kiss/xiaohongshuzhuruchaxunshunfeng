#!/usr/bin/env node
/**
 * 千帆控制台启动入口：CDP 注入守护 + 顺丰运费 Web
 * 由 tongyi.exe 托管，子进程异常退出时自动拉起。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const LOCK_PATH = path.join(ROOT, '.inject-daemon.lock');
const children = new Map();
const restartCounts = new Map();
let shuttingDown = false;

function logDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function logFilePath() {
  return path.join(LOG_DIR, `helper-${logDay()}.log`);
}

function ts() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function emit(line) {
  const full = `[${ts()}] ${line}`;
  process.stdout.write(`${full}\n`);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(logFilePath(), `${full}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

function readConfigPorts() {
  let webPort = 6666;
  let proxyPort = 4725;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    if (Number(cfg.sfFeeWebPort) > 0) webPort = Number(cfg.sfFeeWebPort);
    if (Number(cfg.packageProxyPort) > 0) proxyPort = Number(cfg.packageProxyPort);
  } catch {
    /* ignore */
  }
  return { webPort, proxyPort };
}

function probeUrl(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

function killProcessTree(pid) {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    /* ignore */
  }
}

function killStaleInjectDaemon() {
  if (!fs.existsSync(LOCK_PATH)) return;
  try {
    const oldPid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
    if (oldPid > 0) {
      try {
        process.kill(oldPid, 0);
        emit(`[控制台] 清理旧注入守护 PID ${oldPid}`);
        killProcessTree(oldPid);
      } catch {
        /* stale */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
}

function pipeLines(stream, prefix, isErr) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() || '';
    for (const line of parts) {
      if (!line) continue;
      emit(`${isErr ? `${prefix}ERR ` : prefix}${line}`);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) emit(`${isErr ? `${prefix}ERR ` : prefix}${buf.trim()}`);
  });
}

function scheduleRestart(label, scriptRel, extraEnv = {}) {
  if (shuttingDown) return;
  const n = (restartCounts.get(label) || 0) + 1;
  restartCounts.set(label, n);
  const delay = Math.min(15000, 800 + n * 1200);
  emit(`[控制台] ${label} 将在 ${delay}ms 后自动重启（第 ${n} 次）`);
  setTimeout(() => {
    if (!shuttingDown) startSupervised(label, scriptRel, extraEnv);
  }, delay);
}

function startSupervised(label, scriptRel, extraEnv = {}) {
  if (shuttingDown) return null;

  const script = path.join(ROOT, scriptRel);
  if (label === '注入') killStaleInjectDaemon();

  const env = { ...process.env, ...extraEnv };
  if (label === '注入') env.SF_FEE_FORCE_RESTART = '1';

  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  children.set(label, child);
  const prefix = `[${label}] `;
  pipeLines(child.stdout, prefix, false);
  pipeLines(child.stderr, prefix, true);
  emit(`[控制台] 子进程已启动 · ${label} · PID ${child.pid} · ${scriptRel}`);

  child.on('exit', (code, signal) => {
    children.delete(label);
    const tail = signal ? `signal=${signal}` : `code=${code}`;
    emit(`[${label}] 已退出 ${tail}`);
    if (!shuttingDown) scheduleRestart(label, scriptRel, extraEnv);
  });

  return child;
}

async function healthWatchdog() {
  if (shuttingDown) return;
  const { webPort, proxyPort } = readConfigPorts();
  const proxy = await probeUrl(`http://127.0.0.1:${proxyPort}/health`);
  const web = await probeUrl(`http://127.0.0.1:${webPort}/shunfengchafeiyong/api/status`);

  let proxyFonts = false;
  if (proxy.ok) {
    try {
      const parsed = JSON.parse(proxy.body || '{}');
      proxyFonts = Boolean(parsed?.features?.fonts);
    } catch {
      proxyFonts = false;
    }
  }

  const injectChild = children.get('注入');
  const injectAlive = injectChild && injectChild.exitCode == null && !injectChild.killed;

  if (!proxyFonts && !injectAlive && !shuttingDown) {
    emit('[控制台] 包详情代理未就绪且注入进程不在运行，正在拉起注入…');
    startSupervised('注入', path.join('src', 'auto-inject.js'));
  } else if (!proxyFonts && injectAlive) {
    emit('[控制台] 警告: 注入进程在运行但包详情代理未就绪，请查看注入日志');
  }

  if (!web.ok && !shuttingDown) {
    const webChild = children.get('查询');
    const webAlive = webChild && webChild.exitCode == null && !webChild.killed;
    if (!webAlive) {
      emit('[控制台] 查询页未就绪，正在拉起查询服务…');
      startSupervised('查询', path.join('shunfengchafeiyong', 'server.js'));
    }
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  emit('[控制台] 收到停止信号，正在结束子进程…');
  for (const [, child] of children) {
    try {
      killProcessTree(child.pid);
    } catch {
      /* ignore */
    }
  }
  children.clear();
  killStaleInjectDaemon();
  setTimeout(() => process.exit(0), 500);
}

emit(`[控制台] 顺丰运费服务启动 · 根目录 ${ROOT}`);
emit(`[控制台] 日志文件 ${logFilePath()}`);
emit('[控制台] 组件: CDP 注入守护(auto-inject) + 批量查询 Web(server)');

startSupervised('注入', path.join('src', 'auto-inject.js'));
startSupervised('查询', path.join('shunfengchafeiyong', 'server.js'));

setInterval(() => {
  healthWatchdog().catch(() => {});
}, 20000);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
