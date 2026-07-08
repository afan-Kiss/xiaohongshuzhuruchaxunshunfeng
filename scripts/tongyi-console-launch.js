#!/usr/bin/env node
/**
 * 千帆控制台启动入口：CDP 注入守护 + 顺丰运费 Web
 */
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const children = [];

function pipeLines(stream, prefix) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() || '';
    for (const line of parts) {
      if (line) process.stdout.write(`${prefix}${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) process.stdout.write(`${prefix}${buf.trim()}\n`);
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
  pipeLines(child.stdout, prefix);
  pipeLines(child.stderr, prefix);
  child.on('exit', (code, signal) => {
    const tail = signal ? `signal=${signal}` : `code=${code}`;
    process.stdout.write(`${prefix}已退出 ${tail}\n`);
    const alive = children.some((c) => c.exitCode == null && !c.killed);
    if (!alive) process.exit(typeof code === 'number' ? code : 0);
  });
  return child;
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

start('注入', path.join('src', 'auto-inject.js'));
start('查询', path.join('shunfengchafeiyong', 'server.js'));

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
