# btch

[English](./README.md) · **简体中文**

围绕 [`btch-downloader`](https://www.npmjs.com/package/btch-downloader) npm 包的三个前端，外加一条**纯本地**的转写流水线（ffmpeg + Whisper，零 API key）。

| 前端           | 文件           | 是什么                                                                                       |
|----------------|----------------|----------------------------------------------------------------------------------------------|
| **命令行**     | `cli.js`       | `btch <链接/关键词>` —— 自动识别 + JSON/URL 输出 + 可选下载；`btch transcribe` 走 ffmpeg + Whisper。 |
| **MCP 服务器** | `mcp.mjs`      | 本地 stdio MCP 服务。工具：`list_platforms` · `fetch_media` · `download_media` · `transcribe_media`。 |
| **网页**       | `example.html` | 单页 playground（线上 <https://btch.foo.ng/example.html>）。浏览器内 Whisper 转写（transformers.js）。 |

CLI 和 MCP 共用 `lib/btch.js` + `lib/transcribe.js`；网页独立，全部走 CDN。

`skills/` 目录提供[预制的 Claude Code skills](#skills)，方便别的 agent 直接调用，不用每次重新解释 CLI 怎么用。

## 环境要求

- **Node `>=20.18.1`**（对齐上游库）—— 所有功能必需。
- **ffmpeg** —— 仅 `btch transcribe` 需要。`brew install ffmpeg`（macOS）/ `apt install ffmpeg`（Linux）。
- **本地 Whisper CLI** —— 仅 `btch transcribe` 需要。见下方 [安装 Whisper](#安装-whisper)。

## 安装

```bash
npm install
npm link        # 可选 —— 把 `btch` 和 `btch-mcp` 暴露成全局命令
```

### 安装 Whisper

选适合你机器的一种。CLI 会自动在 PATH 上找 `whisper` 和 `whisper-ctranslate2`；其它的（如 `mlx_whisper`）通过 `BTCH_WHISPER_CMD` 指定。

| 后端 | 适合场景 | 安装 |
|------|---------|------|
| **`mlx-whisper`** ⭐ | **Apple Silicon (M1–M4)** —— 走 MLX，吃 GPU + Neural Engine + 统一内存。Mac 上最快。 | `pip install -U mlx-whisper`，然后 `export BTCH_WHISPER_CMD=mlx_whisper` |
| `whisper-ctranslate2` | 跨平台 CPU。在哪都稳，不用 GPU。 | `pip install -U whisper-ctranslate2` |
| `openai-whisper` | 参考实现。NVIDIA 上能用 CUDA。macOS 上最慢（PyTorch MPS 半残）。 | `pip install -U openai-whisper` |
| `whisper.cpp` | 依赖最少，Mac 上有 Metal 加速。CLI 接口不一样，需要包一层。 | `brew install whisper-cpp`，再让 `BTCH_WHISPER_CMD` 指向一个适配脚本 |

默认模型 `base`。覆盖：单次用 `--model small`，全局用 `BTCH_WHISPER_MODEL=small`。`mlx-whisper` 下短名（`tiny`、`base`、`small` 等）会自动映射到 `mlx-community/whisper-*-mlx` 的 HuggingFace 仓库；传完整路径可手动指定。

#### macOS（Apple Silicon）一站式安装

```bash
brew install ffmpeg                          # 还没装的话
pip3 install --user -U mlx-whisper           # 装到 ~/Library/Python/<version>/bin
```

让 `mlx_whisper` 可访问 —— 选一种：

```bash
# 方案 A —— 把用户站点 bin 加入 PATH（持久）
echo 'export PATH="$HOME/Library/Python/3.10/bin:$PATH"' >> ~/.zshrc
echo 'export BTCH_WHISPER_CMD=mlx_whisper' >> ~/.zshrc
source ~/.zshrc

# 方案 B —— 不动 PATH，用绝对路径
echo 'export BTCH_WHISPER_CMD="$HOME/Library/Python/3.10/bin/mlx_whisper"' >> ~/.zshrc
source ~/.zshrc
```

快速烟雾测试（首次跑会下载 ~75 MB 模型）：

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 /tmp/t.wav -y
btch transcribe /tmp/t.wav --json
```

## 支持的平台

```
instagram · tiktok · facebook · twitter · youtube · mediafire · capcut ·
gdrive · pinterest · douyin · xiaohongshu · snackvideo · cocofun ·
spotify · soundcloud · threads · kuaishou · yts（YouTube 搜索）· aio
```

运行 `btch list` 或调用 MCP 的 `list_platforms` 可在运行时查看注册表。

---

## 1. 命令行（`btch`）

```
btch <链接/关键词> [选项]                  # 抓取 / 下载（默认）
btch transcribe <链接/文件> [选项]          # ffmpeg + 本地 Whisper
btch list                                  # 列出所有平台

下载选项：
  -p, --platform <name>    指定平台（默认自动识别）
  -d, --download           把媒体保存到 ./downloads/<platform>/
  -o, --out <file>         只把第一个媒体存到 <file>
      --first              配合 -d，只下载第一个
      --urls               只输出直链 URL（每行一个）
      --json               输出原始 JSON（默认）
  -q, --quiet              隐藏进度信息

转写选项：
      --lang <iso>         语言提示（en, zh, ja 等）—— 留空则自动识别
      --model <name>       tiny | base | small | medium | large（默认 base）
      --task <kind>        transcribe（默认）或 translate（→ 英文）
      --device <dev>       cpu | cuda | mps（mlx-whisper 忽略）
      --text               输出纯文本（默认）
      --json               输出完整 whisper JSON（文本 + 分段）
      --srt                输出带时间戳的 SubRip 字幕
  -s, --save <file>        额外把转写写入 <file>
      --keep-audio         保留中间产物 .mp3
```

### 下载示例

```bash
# 自动识别 TikTok 并打印原始 JSON
btch https://www.tiktok.com/@omagadsus/video/7025456384175017243

# 强制走 YouTube 搜索
btch "Somewhere Only We Know" -p yts

# 把 Instagram 帖子里的所有媒体下载下来
btch https://www.instagram.com/reel/DKPtUL_S9Nh/ -d

# 只把第一个媒体存到指定路径
btch https://pin.it/4CVodSq -o ./pin.jpg

# 把直链 pipe 给别的工具（yt-dlp、aria2c、curl 等）
btch https://youtu.be/C8mJ8943X80 --urls | head -1 | xargs curl -L -o video.mp4
```

### 转写示例

```bash
# 抽取 TikTok 中文脚本
btch transcribe https://www.tiktok.com/@user/video/123 --lang zh

# 给 YouTube 视频生成 .srt 字幕
btch transcribe https://youtu.be/XYZ --srt -s subtitles.srt

# 用更大的模型转写本地访谈
btch transcribe ./interview.mp4 --model small --json -s interview.json

# 把日语音频翻译成英文文本
btch transcribe ./jp-clip.mp3 --task translate -s en.txt

# 转写后 pipe 给别的 LLM / agent 做摘要
btch transcribe https://youtu.be/XYZ -q | your-llm-cli summarize
```

---

## 2. MCP 服务器（`btch-mcp`）

通过 stdio 提供 MCP 服务，注册了四个工具：

| 工具                | 作用                                                                                       |
|---------------------|--------------------------------------------------------------------------------------------|
| `list_platforms`    | 列出所有支持的平台。                                                                       |
| `fetch_media`       | 解析链接或搜索词，返回媒体元信息和直链 URL，自动识别平台。                                  |
| `download_media`    | 同上，但额外把媒体写入本地磁盘，并返回保存路径。                                            |
| `transcribe_media`  | URL 或本地文件 → ffmpeg → 本地 Whisper → `{ text, segments, language }`（text / srt / json）。 |

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
> *用 `transcribe_media` 把这条抖音视频转成字幕。*

### 独立运行 / 调试

```bash
node mcp.mjs                                   # 前台运行 MCP stdio 服务
node scripts/smoke-mcp.mjs                     # 握手 + tools/list + list_platforms
node scripts/smoke-mcp-fetch.mjs "Keane" yts   # 真实调用 fetch_media
```

> stdout 是 MCP 传输通道，所以启动横幅和错误都打到 stderr，避免污染协议流。

---

## 3. 网页 playground（`example.html`）

推荐用 `npm run web` 启动本地服务（`file://` 协议根本不能跨域请求）：

```bash
npm run web    # 用 npx http-server 起 :8080
```

特性：

- 平台下拉框 + 粘贴 URL 后自动识别
- 每个平台都有示例 URL（点击直接填入）
- 结果网格：每个直链配 **save / open / copy / script** 四个按钮
- **浏览器内 Whisper 转写**（`@huggingface/transformers`）—— 零 API key，模型首次下载后存 IndexedDB（`tiny` 约 75 MB）
- 转写输出支持 copy / 下载 `.txt` / 下载带时间戳的 `.srt`
- CORS 被 CDN 拦截时（社媒链接大多数都拦）：点 `script` 会自动触发普通下载，并把文件选择器高亮提示你拖文件上来
- 原始 JSON 面板，便于调试
- 支持深链：`example.html?url=<encoded>&platform=youtube`

可选模型：`whisper-tiny`（默认）· `whisper-base` · `whisper-small` · `whisper-tiny.en`。

---

## Skills

`skills/` 目录里有现成的 [Claude Code skills](https://docs.anthropic.com/)，别的 agent 加载后就能直接调用 CLI，不用每次重新解释：

| Skill | 触发词 |
|-------|--------|
| [`btch-download`](./skills/btch-download/SKILL.md) | 下载视频、抓视频、抓图、提取媒体、save a TikTok / YouTube / Instagram link 等 |
| [`btch-transcribe`](./skills/btch-transcribe/SKILL.md) | 提取脚本、提取字幕、转写、出 srt、transcribe a video / audio、generate subtitles 等 |

安装到用户级目录：

```bash
ln -s "$(pwd)/skills/btch-download"  ~/.claude/skills/btch-download
ln -s "$(pwd)/skills/btch-transcribe" ~/.claude/skills/btch-transcribe
```

Claude Code 会根据每个 skill frontmatter 里 `description` 中的触发词自动加载。

---

## 目录结构

```
cli.js              # 命令行入口（CommonJS）—— 默认模式 + `transcribe` 子命令
mcp.mjs             # MCP 服务（ESM，通过 createRequire 加载 CJS 共享库）
lib/btch.js         # 共享的平台注册表、detect()、harvestMedia()、下载工具
lib/transcribe.js   # ffmpeg + 本地 Whisper 调用（mlx / openai / ct2）
example.html        # 独立的浏览器 playground（用 transformers.js 做浏览器内 Whisper）
scripts/            # MCP 服务的烟雾测试
skills/             # Claude Code skill 包（下载 + 转写）
```

媒体抓取走 `btch-downloader` 的上游 API —— 已知限制详见[库的 README](https://www.npmjs.com/package/btch-downloader)。转写完全本地完成（CLI/MCP 用系统 Whisper，网页端在浏览器里跑）。

## License

Apache 2.0 —— 详见 [`LICENSE`](./LICENSE)。
