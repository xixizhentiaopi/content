# btch

[English](./README.md) · **简体中文**

围绕 [`btch-downloader`](https://www.npmjs.com/package/btch-downloader) npm 包的三个前端：

| 前端           | 文件           | 是什么                                                                       |
|----------------|----------------|------------------------------------------------------------------------------|
| **命令行**     | `cli.js`       | `btch <链接或关键词>` —— 自动识别、JSON / URL 输出，可选下载。                |
| **MCP 服务器** | `mcp.mjs`      | 本地 Model Context Protocol stdio 服务，供 Claude Code 等客户端调用。        |
| **网页**       | `example.html` | 单页 playground（线上：<https://btch.foo.ng/example.html>）。                |

命令行和 MCP 服务器共用 `lib/btch.js`，平台注册表和媒体解析逻辑只此一份。网页则刻意保持独立，通过 jsDelivr 直接从 CDN 加载库。

## 环境要求

- Node `>=20.18.1`（对齐上游库的要求）

## 安装

```bash
npm install
npm link        # 可选 —— 把 `btch` 和 `btch-mcp` 暴露成全局命令
```

## 支持的平台

```
instagram · tiktok · facebook · twitter · youtube · mediafire · capcut ·
gdrive · pinterest · douyin · xiaohongshu · snackvideo · cocofun ·
spotify · soundcloud · threads · kuaishou · yts（YouTube 搜索）· aio
```

运行 `btch list` 或调用 MCP 的 `list_platforms` 工具可在运行时查看注册表。

---

## 1. 命令行（`btch`）

```
btch <链接或关键词> [选项]

  -p, --platform <name>    指定平台（默认自动识别）
  -d, --download           把解析到的媒体保存到 ./downloads/<platform>/
  -o, --out <file>         只把第一个媒体保存到 <file>
      --first              配合 -d，只下载第一个
      --urls               只输出直链 URL（每行一个）
      --json               输出原始 JSON（默认）
  -q, --quiet              隐藏进度信息
  -h, --help               显示帮助
  btch list                列出所有支持的平台
```

### 示例

```bash
# 自动识别 TikTok 并打印原始 JSON
btch https://www.tiktok.com/@omagadsus/video/7025456384175017243

# 强制走 YouTube 搜索
btch "Somewhere Only We Know" -p yts

# 把 Instagram 帖子里的所有媒体下载下来
btch https://www.instagram.com/reel/DKPtUL_S9Nh/ -d

# 把第一个媒体保存到指定路径
btch https://pin.it/4CVodSq -o ./pin.jpg

# 把直链管道给别的工具用（yt-dlp、aria2c、curl 等）
btch https://youtu.be/C8mJ8943X80 --urls | head -1 | xargs curl -L -o video.mp4
```

---

## 2. MCP 服务器（`btch-mcp`）

通过 stdio 提供 MCP 服务，注册了三个工具：

| 工具             | 作用                                                                              |
|------------------|------------------------------------------------------------------------------------|
| `list_platforms` | 列出所有支持的平台。                                                               |
| `fetch_media`    | 解析链接或搜索词，返回媒体元信息和直链 URL，自动识别平台。                         |
| `download_media` | 同上，但额外把媒体写入本地磁盘，并返回保存路径。                                   |

### 在 Claude Code 中注册

```bash
claude mcp add btch -- node /绝对路径/到/本仓库/mcp.mjs
claude mcp list
```

或手动写入 `~/.claude.json` / `~/.config/claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "btch": {
      "command": "node",
      "args": ["/绝对路径/到/本仓库/mcp.mjs"]
    }
  }
}
```

重启客户端后即可这样调用：

> *用 btch MCP 把这个 Spotify 链接的音频 URL 拿出来。*
>
> *用 `download_media` 把 `<tiktok 链接>` 的第一个媒体存到 `~/Movies/scratch`。*

### 独立运行 / 调试

```bash
node mcp.mjs                                   # 前台运行 MCP stdio 服务
node scripts/smoke-mcp.mjs                     # 握手 + tools/list + list_platforms
node scripts/smoke-mcp-fetch.mjs "Keane" yts   # 真实调用 fetch_media
```

> stdout 是 MCP 传输通道，所以启动横幅和错误都打到 stderr，避免污染协议流。

---

## 3. 网页 playground（`example.html`）

直接在浏览器打开，或者起一个静态服务：

```bash
npm run web    # 用 npx http-server 起 :8080
```

特性：

- 平台下拉框 + 粘贴 URL 后自动识别
- 每个平台都有示例 URL（点击直接填入）
- 结果以网格展示，每个直链都附带 下载 / 打开 / 复制 按钮
- 原始 JSON 面板，便于调试
- 支持深链：`example.html?url=<encoded>&platform=youtube`

---

## 目录结构

```
cli.js              # 命令行入口（CommonJS）
mcp.mjs             # MCP 服务（ESM，通过 createRequire 加载 CJS 共享库）
lib/btch.js         # 共享的平台注册表、detect()、harvestMedia()、下载工具
example.html        # 独立的浏览器 playground（不依赖 lib/btch.js）
scripts/            # MCP 服务的烟雾测试
```

所有请求都打到 `btch-downloader` 上游 API —— 已知限制详见[库的 README](https://www.npmjs.com/package/btch-downloader)。

## License

Apache 2.0 —— 详见 [`LICENSE`](./LICENSE)。
