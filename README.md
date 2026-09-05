# 小白大世界 · Xiaobai's World

**小白超白的** 的个人作品集官网。

当前版本采用 **小白优先的单页结构 + 程序化 3D 大爆炸星云背景**：打开网站先看到一场粉白能量大爆炸，随后进入小白介绍，再滚动浏览作品。3D 只作为固定背景氛围，不参与内容布局，因此不存在“关于小白挡住作品 / 内容交叉”的问题。

## 线上访问

```text
https://wqrnb.github.io/xiaobai-world/
```

## 页面结构

1. **关于小白**：头像、名字、简介、B站 / 小红书数据、关注按钮
2. **精选焦点**：横向滑动的精选作品
3. **小红书岛**：32 件真实作品，支持分类筛选
4. **B站视频墙**：42 支真实视频，播放 / 弹幕 / 日期
5. **关注小白**：B站 / 小红书关注卡片

支持搜索、日夜粉白主题切换、内置原创八音盒（默认关闭）。3D 背景为纯程序化生成（能量核心、粒子爆发、冲击波、星云、bloom），不加载任何纹理图片。滚动到不同章节时会触发相机跃迁、闪光和星云配色渐变，鼠标移动会产生视差。界面图标使用本地打包的 Lucide 线性 SVG 图标，不使用 emoji。

## 本地运行

直接双击 `index.html` 即可，无需服务器、无需安装依赖：

- 数据内嵌在 `assets/js/data.js`（`window.SITE_DATA`）
- 3D 背景使用本地打包的 Three.js r128 与 bloom 后处理，file:// 可用
- 图片使用本地相对路径，普通 `<img>` 在 file:// 下可正常显示
- 无 CDN、无构建、无第三方运行时依赖

## 内容数据

真实统计：B站 关注287 · 粉丝2,518 · 获赞13.5万 · 播放163.9万 · 视频73 · 图文20；小红书 粉丝1千+ · 获赞与收藏1万+ · 小红书号888313077。

## 目录

```text
site/
├─ index.html
├─ README.md
├─ favicon.png
├─ favicon.ico
└─ assets/
   ├─ css/style.css
   ├─ js/data.js
   ├─ js/icons.js
   ├─ js/three-bg.js
   ├─ js/app.js
   ├─ lib/              # Three.js r128 与 bloom 后处理
   └─ images/           # 小红书封面 / B站封面 / 头像
```

## 数据更新方式

1. 更新 `xhs-home/demo-data.json` 和 `xhs-home/assets/` 下的封面、头像。
2. 在项目根目录执行：

```powershell
node tools/build.mjs
```

3. 脚本会复制图片，并重新生成 `site/assets/js/data.js`。
4. 本地双击 `site/index.html` 验收后重新部署。

## 部署命令

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/deploy.ps1
```

或手动部署：

```powershell
cd site
git init -b main
git add -A
git commit -m "deploy: 小白大世界"
gh repo create <用户名>/xiaobai-world --public --source . --remote origin --push
gh api repos/<用户名>/xiaobai-world/pages -f "source[branch]=main" -f "source[path]=/" -X POST
```

## 许可与素材

- 代码：MIT
- 作品封面、头像、标题、数据均来自「小白超白的」公开主页，仅用于个人作品集展示
- 未使用受版权保护的图片、字体或音乐文件；背景音乐为内置原创程序化八音盒
- 3D 背景的分幕转场与滚动相机思路参考了开源项目 `brunosimon/folio-2019`（MIT License）
