#!/usr/bin/env node
/**
 * 一键：npm install + 写入「启动文件夹」隐藏自启 + 立即拉起守护
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STARTUP =
  process.env.APPDATA &&
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const VBS_NAME = '千帆顺丰运费注入.vbs';
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

function ensureConfig() {
  if (fs.existsSync(CONFIG_PATH)) return;
  if (fs.existsSync(EXAMPLE_PATH)) {
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    console.log('[install] 已创建 config.json，请填入 sf.partnerID 与 sf.checkWord');
  }
}

function writeVbs() {
  const nodeExe = process.execPath.replace(/\\/g, '\\\\');
  const script = path.join(ROOT, 'src', 'auto-inject.js').replace(/\\/g, '\\\\');
  const workDir = ROOT.replace(/\\/g, '\\\\');
  const content = `Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "${workDir}"
sh.Run """${nodeExe}"" ""${script}""", 0, False
`;
  const vbsPath = path.join(STARTUP, VBS_NAME);
  fs.writeFileSync(vbsPath, `\uFEFF${content}`, 'utf8');
  return vbsPath;
}

function startDaemonNow() {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'auto-inject.js')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: ROOT,
  });
  child.unref();
}

function main() {
  if (!STARTUP || !fs.existsSync(path.dirname(STARTUP))) {
    console.error('[install] 找不到 Windows 启动文件夹');
    process.exit(1);
  }

  console.log('[install] npm install …');
  execSync('npm install', { cwd: ROOT, stdio: 'inherit' });

  ensureConfig();

  const vbsPath = writeVbs();
  console.log('[install] 已写入开机自启:', vbsPath);

  startDaemonNow();
  console.log('[install] 守护进程已在后台运行');
  console.log('[install] 启动千帆调试模式后，订单卡内会自动显示月结费用与退款信息');
  console.log('[install] 丰桥凭证请编辑:', CONFIG_PATH);
}

main();
