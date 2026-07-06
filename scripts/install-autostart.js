#!/usr/bin/env node
/**
 * 一键：npm install + 写入「启动文件夹」隐藏自启 + 立即拉起守护
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { loadLauncherIconDataUrl, DESKTOP_ICON, PROJECT_ICON } = require('../src/load-launcher-icon');

const ROOT = path.resolve(__dirname, '..');
const STARTUP =
  process.env.APPDATA &&
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const VBS_NAME = '千帆顺丰运费注入.vbs';
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

function ensureLauncherIcon() {
  fs.mkdirSync(path.dirname(PROJECT_ICON), { recursive: true });
  if (fs.existsSync(DESKTOP_ICON)) {
    fs.copyFileSync(DESKTOP_ICON, PROJECT_ICON);
    console.log('[install] 已同步桌面图标 → assets/launcher.ico');
  } else if (!fs.existsSync(PROJECT_ICON)) {
    console.warn('[install] 未找到桌面 1.ico，侧栏将使用 SF 文字图标');
  }
}

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
  ensureLauncherIcon();

  const vbsPath = writeVbs();
  console.log('[install] 已写入开机自启:', vbsPath);

  startDaemonNow();
  console.log('[install] 守护进程已在后台运行');
  console.log('[install] 现在启动/切换千帆调试模式即可，右侧会自动出现「顺丰月结运费」侧栏');
  console.log('[install] 丰桥凭证请编辑:', CONFIG_PATH);
}

main();
