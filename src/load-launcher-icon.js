const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ICON = path.join(ROOT, 'assets', 'launcher.ico');
const DESKTOP_ICON = path.join(os.homedir(), 'Desktop', '1.ico');

function resolveIconPath() {
  if (fs.existsSync(PROJECT_ICON)) return PROJECT_ICON;
  if (fs.existsSync(DESKTOP_ICON)) return DESKTOP_ICON;
  return '';
}

function loadLauncherIconDataUrl() {
  const iconPath = resolveIconPath();
  if (!iconPath) return '';
  const buf = fs.readFileSync(iconPath);
  return `data:image/x-icon;base64,${buf.toString('base64')}`;
}

module.exports = {
  PROJECT_ICON,
  DESKTOP_ICON,
  resolveIconPath,
  loadLauncherIconDataUrl,
};
