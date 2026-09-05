# 小白大世界 · Xiaobai's World

**小白超白的** 的个人作品集官网 — 全站 3D 大世界版。

粉白泡泡园 × 星空展馆：中央 LED 大球巡游作品封面，漂浮岛上挂着小红书 / B站 的发光画框。桌面端完整辉光，移动端自动降级，WebGL 不可用时自动切换 2D 静态页。

## 线上访问

```text
https://wqrnb.github.io/xiaobai-world/
```

## 本地运行

直接双击 `index.html` 即可，无需服务器、无需安装依赖：

- 数据内嵌在 `assets/js/data.js`（`window.SITE_DATA`）
- 图片内嵌在 `assets/js/images.js`（data URI，用于解决 file:// 下 WebGL 纹理 CORS 限制）
- Three.js r128 及 OrbitControls / EffectComposer / UnrealBloomPass 全部本地打包在 `assets/lib/`
- 背景音乐为内置原创程序化八音盒（Web Audio 生成，无版权文件，默认关闭）

## 内容

| 分区 | 内容 |
| --- | --- |
| 中央 LED 大球 | 32 条小红书封面滚动巡游 + 分类星环 |
| 小红书岛 | 32 件作品画框，点击看详情，可跳原笔记 |
| B站视频墙 | 42 支视频画框，播放 / 弹幕 / 日期 / 原视频直链 |
| 精选岛 | 高赞 / 高播放焦点作品 |
| 关于 / 关注 | 小白头像、简介、B站 / 小红书关注卡片 |

真实统计：B站 关注287 · 粉丝2,518 · 获赞13.5万 · 播放163.9万 · 视频73 · 图文20；小红书 粉丝1千+ · 获赞与收藏1万+ · 小红书号888313077。

## 操作

- 鼠标拖动旋转视角 / 滚轮缩放 / 触屏手势
- 顶部导航：首页 / 作品 / 视频墙 / 关于小白 / 关注（平滑传送）
- 底部视角坞：球体正面 / 小红书岛 / B站视频墙 / 关于 / 关注
- 🔍 搜索：输入关键词，点击结果自动飞到对应画框并高亮
- 🌙 日夜切换：粉白日间泡泡园 ↔ 深粉夜间霓虹秀
- 🎵 音乐：默认关闭，点击后播放内置八音盒

## 目录

```text
site/
├─ index.html
├─ README.md
└─ assets/
   ├─ css/style.css
   ├─ js/data.js        # 真实数据（自动生成）
   ├─ js/images.js      # 图片 data URI（自动生成）
   ├─ js/app.js         # 3D 大世界主程序
   ├─ lib/              # Three.js r128 及后处理 addon
   └─ images/           # 小红书封面 / B站封面 / 头像
```

## 数据更新方式

1. 更新 `xhs-home/demo-data.json` 和 `xhs-home/assets/` 下的封面、头像。
2. 在项目根目录执行：

```powershell
node tools/build.mjs
```

3. 脚本会自动：
   - 复制封面与头像到 `site/assets/images/`
   - 重新生成 `site/assets/js/data.js`
   - 重新生成 `site/assets/js/images.js`

4. 本地双击 `site/index.html` 验收后重新部署。

## 部署命令

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/deploy.ps1
```

脚本会创建/更新公开仓库 `xiaobai-world`，推送 `site/` 内容到 `main`，启用 GitHub Pages，并打开线上地址。

也可以手动部署：

```powershell
cd site
git init -b main
git add -A
git commit -m "deploy: 小白大世界"
gh repo create <用户名>/xiaobai-world --public --source . --remote origin --push
gh api repos/<用户名>/xiaobai-world/pages -f "source[branch]=main" -f "source[path]=/" -X POST
```

## 许可与素材

- 代码：MIT（Three.js 及其 addon 版权归 Three.js Authors，MIT License）
- 作品封面、头像、标题、数据均来自「小白超白的」公开主页，仅用于个人作品集展示
- 未使用任何受版权保护的图片、字体或音乐文件；界面使用系统圆体字体栈
