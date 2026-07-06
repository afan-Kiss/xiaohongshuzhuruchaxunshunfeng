# 千帆顺丰月结运费侧栏

千帆客服台**调试模式**启动后，后台守护进程通过 CDP 自动注入右侧「顺丰月结运费」侧栏，**无需手动 F12 粘贴**。

## 一次性安装（已执行则跳过）

```bat
cd /d "E:\我的软件源码\小红书运费顺丰真实查询"
npm run install:autostart
```

效果：

1. `npm install` 安装依赖  
2. 写入 Windows **启动文件夹**（登录后自动运行隐藏守护）  
3. 立即在后台启动 CDP 注入守护  

## 丰桥凭证（只需填一次）

编辑 [`config.json`](config.json)：

```json
{
  "sf": {
    "partnerID": "你的丰桥顾客编码",
    "checkWord": "你的丰桥校验码",
    "phoneLast4": "",
    "sandbox": false
  }
}
```

保存后重启守护（注销再登录，或任务管理器结束 node 后重新登录）即可；也可在侧栏 ⚙ 填写（存 localStorage）。

## DevTools 端口

默认自动读取同目录 [`千帆中转机器人/config.wxbot-new.json`](../千帆中转机器人/config.wxbot-new.json) 里的 `qianfanDebug.devtoolsPort`（你当前为 **9223**）。

## 日常使用

照常用桌面 **「启动千帆客服调试模式」** 打开千帆 → 打开客服工作台页面 → 右侧自动出现侧栏 → 点买家即可查顺丰月结扣费。

## 文件

| 文件 | 说明 |
|------|------|
| `src/auto-inject.js` | CDP 守护，轮询 DevTools 并注入 |
| `inject/qf-sf-fee-panel.js` | 侧栏 UI + 顺丰 API |
| `scripts/install-autostart.js` | 安装开机自启 |
