#!/usr/bin/env node
/**
 * 千帆控制台启动入口：CDP 注入守护 + 顺丰运费 Web
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const children = [];

function logDay() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function pipeLines(stream, prefix, isErr) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() || '';
    for (const line of parts) {
      if (!line) continue;
      const tag = isErr ? `${prefix}ERR ` : prefix;
      emit(`${tag}${line}`);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) {
      const tag = isErr ? `${prefix}ERR ` : prefix;
      emit(`${tag}${buf.trim()}`);
    }
  });
}

function start(label, scriptRel) {
  const script = path.join(ROOT, scriptRel);
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  const prefix = `[${label}] `;
  pipeLines(child.stdout, prefix, false);
  pipeLines(child.stderr, prefix, true);
  emit(`[控制台] 子进程已启动 · ${label} · PID ${child.pid} · ${scriptRel}`);
  child.on('exit', (code, signal) => {
    const tail = signal ? `signal=${signal}` : `code=${code}`;
    emit(`[${label}] 已退出 ${tail}`);
    const alive = children.some((c) => c.exitCode == null && !c.killed);
    if (!alive) process.exit(typeof code === 'number' ? code : 0);
  });
  return child;
}

function shutdown() {
  emit('[控制台] 收到停止信号，正在结束子进程…');
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

emit(`[控制台] 顺丰运费服务启动 · 根目录 ${ROOT}`);
emit(`[控制台] 日志文件 ${logFilePath()}`);
emit('[控制台] 组件: CDP 注入守护(auto-inject) + 批量查询 Web(server)');

start('注入', path.join('src', 'auto-inject.js'));
start('查询', path.join('shunfengchafeiyong', 'server.js'));

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
