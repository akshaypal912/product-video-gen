# Product Video Gen

> Turn a product description into a polished SaaS/product-launch video using local AI, motion graphics, voiceover, music, and sound effects.

[![Node.js](https://img.shields.io/badge/Node.js-required-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-Qwen%202.5%20Coder%203B-black?logo=ollama&logoColor=white)](https://ollama.com/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-render-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![License](https://img.shields.io/badge/license-unlicensed-lightgrey)](#license)

Product Video Gen is an AI-assisted video generation pipeline that converts a natural-language product description into a structured storyboard, then renders that storyboard into a finished MP4.

The default workflow runs **entirely locally** with **Ollama + Qwen 2.5 Coder 3B**, **Piper TTS**, **HyperFrames**, and **FFmpeg**, with a Node.js API and web interface on top.

---

## 📺 Demo

> _Add a thumbnail, GIF, or short clip of a generated `product-launch.mp4` here so visitors can see the output immediately._

```
docs/demo.gif
```

---

## Table of Contents

- [Features](#-features)
- [How It Works](#-how-it-works)
- [AI Storyboard Generation](#-ai-storyboard-generation)
- [Local AI Stack](#-local-ai-stack)
- [Rendering Pipeline](#-rendering-pipeline)
- [Audio Pipeline](#-audio-pipeline)
- [Validation & Reliability](#-validation--reliability)
- [Architecture](#️-architecture)
- [Project Structure](#-project-structure)
- [Requirements](#️-requirements)
- [Installation](#-installation)
- [Environment Configuration](#-environment-configuration)
- [Running the Project](#️-running-the-project)
- [Generate a Video](#-generate-a-video)
- [API](#-api)
- [Testing](#-testing)
- [Useful Commands](#️-useful-commands)
- [Output Format](#️-output-format)
- [Design Philosophy](#-design-philosophy)
- [Current Limitations](#-current-limitations)
- [Roadmap](#️-roadmap)
- [Contributing](#-contributing)
- [Documentation](#-documentation)
- [License](#-license)

---

## ✨ Features

- 🧠 AI-generated product video storyboards
- 🏠 Local LLM inference with Ollama
- 🎬 Reusable HyperFrames scene templates
- 🎙️ Local Piper voiceover
- 🎵 Background music and sound effects
- ✅ Strict storyboard schema validation with AJV
- 🛠️ AI-output normalization and repair
- 🔊 Duration-aware voiceover handling
- 🌐 Web UI for video generation
- 🚀 REST API with asynchronous rendering jobs
- 🔒 API keys and local models kept outside source control
- 💸 Local-first workflow with no paid LLM required by default

---

## 🎥 How It Works

```text
Product Description
        │
        ▼
Ollama + Qwen 2.5 Coder 3B
        │
        ▼
Storyboard JSON
        │
        ▼
Normalize AI Output
        │
        ▼
AJV Schema Validation
        │
        ▼
Voiceover Policy + CTA Repair
        │
        ▼
Director Validation
        │
        ▼
Piper TTS
        │
        ▼
BGM + SFX
        │
        ▼
HyperFrames
        │
        ▼
FFmpeg
        │
        ▼
Final MP4
```

The LLM generates a structured storyboard, not arbitrary HTML, CSS, or JavaScript. Rendering remains deterministic and template-driven.

---

## 🧠 AI Storyboard Generation

The application converts a product description into a structured sequence of scenes.

**Typical narrative:**

```text
Hook → Friction / Problem → Benefit → Proof → Ecosystem / Integrations → CTA
```

The storyboard contract supports scene roles such as:

`hook` · `friction` · `problem` · `reveal` · `proof` · `ecosystem` · `benefit` · `cta` · `close`

Current scene types include:

- `logo-intro`
- `text-reveal`
- `stat-callout`
- `icon-grid`
- `cta-outro`

---

## 🏠 Local AI Stack

The default storyboard generation uses:

- **Ollama**
- **qwen2.5-coder:3b**

This model is intentionally used locally to keep the workflow lightweight and avoid depending on paid LLM APIs.

> Mistral remains available as an alternative provider.

**Why Qwen 3B?**

The project was designed to work on consumer hardware with limited RAM and integrated graphics. A smaller local model provides a better speed/memory trade-off for this constrained storyboard-generation task.

---

## 🎨 Rendering Pipeline

Each storyboard scene maps to a reusable HyperFrames template.

| Storyboard Scene | Template |
|---|---|
| `logo-intro` | `logo-intro.html` |
| `text-reveal` | `text-reveal.html` |
| `stat-callout` | `stat-callout.html` |
| `icon-grid` | `icon-grid.html` |
| `cta-outro` | `cta-outro.html` |

The master composition is generated from the storyboard:

```text
storyboard.json
      ↓
build/index.html
      ↓
HyperFrames
      ↓
rendered video
      ↓
FFmpeg
      ↓
product-launch.mp4
```

The visual layer is built with **HTML**, **CSS**, **GSAP**, and **HyperFrames**.

---

## 🔊 Audio Pipeline

Audio is assembled from multiple sources:

```text
Piper Voice + Background Music + Sound Effects → Final Audio Mix
```

The system can generate:

- Voice narration
- Background music
- Whoosh effects
- Sweep effects
- Impact effects
- Tick effects
- Connection effects
- Rise effects

### Voiceover Reliability

Voiceover is **duration-aware**.

Very short scenes do not force narration when there is not enough time for natural speech:

```text
Short scene → Voiceover disabled → BGM + SFX continue

Longer scene → Piper TTS → Measure WAV duration → Fit against scene slot → Render
```

Generated narration is never silently truncated. If an enabled narration clip cannot safely fit, the pipeline fails explicitly instead of producing broken audio.

---

## ✅ Validation & Reliability

AI output is treated as **untrusted structured data**.

The Ollama pipeline performs:

```text
Qwen JSON → Parse → Normalize → AJV → Voiceover Policy → CTA Repair → Director Validation → Render
```

The normalization layer handles common small-model mistakes such as:

- Lines returned in the wrong type
- Invalid icon colors
- Malformed structured fields

The director checks protect against:

- Unsupported integrations
- Invented statistics
- Duplicated narration
- Excessive narration
- CTA duplication
- Invalid scene roles
- Invalid scene structure
- Unsupported content

---

## 🏗️ Architecture

```text
                      ┌─────────────────────┐
                      │   Product Input      │
                      │      Web / API       │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │ Ollama + Qwen 3B     │
                      │ Storyboard Director  │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │ Normalize + AJV      │
                      │ Schema Validation    │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │ VO Policy + CTA      │
                      │ Repair + Director    │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │ Piper + BGM + SFX    │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │ HyperFrames          │
                      │ HTML/CSS/GSAP        │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │ FFmpeg               │
                      │ Final MP4            │
                      └─────────────────────┘
```

---

## 📁 Project Structure

```text
product-video-gen/
│
├── assets/                  # Visual assets
├── audio/                   # Music, SFX and voice assets
├── compositions/            # HyperFrames scene templates
├── docs/                    # Technical documentation
├── examples/                # Example descriptions/storyboards
├── prompts/                 # LLM director prompts
├── schemas/                 # Storyboard JSON schema
├── scripts/                 # Build/render/audio utilities
├── server/                  # Node.js API and job system
├── tests/                   # Unit and integration tests
├── web/                     # Web interface
│
├── storyboard.json          # Current storyboard
├── theme.css                # Visual theme tokens
├── package.json
├── package-lock.json
├── hyperframes.json
└── README.md
```

---

## ⚙️ Requirements

Install the following before getting started:

- [Node.js](https://nodejs.org/)
- npm
- [Ollama](https://ollama.com/)
- `qwen2.5-coder:3b` (via Ollama)
- [Piper TTS](https://github.com/rhasspy/piper)
- [FFmpeg](https://ffmpeg.org/)

---

## 📦 Installation

Clone the repository:

```bash
git clone https://github.com/akshaypal912/product-video-gen.git
cd product-video-gen
```

Install dependencies:

```bash
npm install
```

Install the local Qwen model:

```bash
ollama pull qwen2.5-coder:3b
```

---

## 🔐 Environment Configuration

Create your local environment file from the example:

```bash
cp .env.example .env
```

Example configuration:

```env
LLM_PROVIDER=ollama

OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:3b

OLLAMA_TIMEOUT_MS=120000
OLLAMA_TEMPERATURE=0.1
OLLAMA_NUM_PREDICT=1400
OLLAMA_NUM_CTX=4096

TTS_ENABLED=true
TTS_ENGINE=piper
```

> ⚠️ Keep `.env` private. Do not commit API keys, local model files, private credentials, or generated development artifacts that are not intended for source control.

---

## ▶️ Running the Project

Start Ollama:

```bash
ollama serve
```

Start the application:

```bash
npm run server
```

Open the web application:

```
http://127.0.0.1:8787
```

---

## 🎬 Generate a Video

Enter a product description into the web UI. Example:

> Tables is an AI-powered customer intelligence platform for modern sales teams. It helps sales teams discover and connect with the right prospects faster, provides access to 297M+ professional profiles, and connects customer data across LinkedIn and HubSpot.

The application will:

```text
Product description
        ↓
AI storyboard
        ↓
Validation / normalization
        ↓
Audio generation
        ↓
Motion graphics rendering
        ↓
Final MP4
```

---

## 📡 API

### Health

```http
GET /health
```

### Generate Video

```http
POST /api/videos/generate
Content-Type: application/json
```

**Request body:**

```json
{
  "productDescription": "Your product description here"
}
```

**Example:**

```bash
curl -X POST http://127.0.0.1:8787/api/videos/generate \
  -H "Content-Type: application/json" \
  -d "{\"productDescription\":\"Tables is an AI-powered customer intelligence platform for modern sales teams.\"}"
```

The endpoint returns a job ID.

### Get Job Status

```http
GET /api/videos/:jobId
```

### Download Video

```http
GET /api/videos/:jobId/download
```

📄 More API details: [`docs/api.md`](docs/api.md)

---

## 🧪 Testing

Run the complete test suite:

```bash
npm test
```

The test suite covers areas including:

- Storyboard schema validation
- Ollama provider selection
- Ollama output normalization
- Director validation
- Voiceover policy
- CTA repair
- Piper fitting
- Audio handling
- API/job behavior
- Rendering workflow

---

## 🛠️ Useful Commands

| Command | Description |
|---|---|
| `npm test` | Run the test suite |
| `npm run server` | Run the API |
| `npm run validate:storyboard` | Validate storyboard |
| `npm run populate` | Populate the master composition |
| `npm run render:video` | Render the video |
| `npm run generate:audio` | Generate audio assets |

---

## 🎞️ Output Format

Typical rendered output:

| Property | Value |
|---|---|
| Resolution | 1920 × 1080 |
| FPS | 30 |
| Video | H.264 |
| Audio | AAC-LC |
| Container | MP4 |

---

## 🌟 Design Philosophy

The project intentionally separates **creative planning** from **video rendering**.

**The LLM is responsible for:**
- What should the video say?
- What scenes should exist?
- What should each scene communicate?

**The rendering system is responsible for:**
- How should the scene look?
- How should it animate?
- How should audio be synchronized?
- How should the final MP4 be rendered?

This separation makes the system more:

`predictable` · `testable` · `maintainable` · `debuggable` · `resilient to imperfect local models`

---

## 🚧 Current Limitations

The current implementation is a **template-driven** product-launch video generator. It does not yet generate completely arbitrary cinematic footage for every prompt.

The current system focuses on:

```text
Reliable storyboard generation
+ Reusable motion graphics
+ Local voice/audio
+ Deterministic rendering
```

...rather than unrestricted AI-generated video footage.

---

## 🗺️ Roadmap

- [ ] More cinematic scene templates
- [ ] Better product-specific visual metaphors
- [ ] Product screenshot animation
- [ ] Brand/theme extraction
- [ ] Higher-quality voice generation
- [ ] AI-generated visual assets
- [ ] AI-generated background footage
- [ ] More advanced audio mixing
- [ ] Persistent job storage
- [ ] Cloud rendering
- [ ] Production deployment
- [ ] Authentication and user accounts
- [ ] Multi-format exports

---

## 🤝 Contributing

Contributions are welcome!

When adding a new scene type:

1. Create a reusable HyperFrames template.
2. Define its storyboard contract.
3. Update validation rules.
4. Add tests.
5. Verify the rendered output.

> Keep the LLM responsible for generating the storyboard contract rather than arbitrary frontend or rendering code.

---

## 📄 Documentation

Additional technical documentation:

- [`docs/api.md`](docs/api.md)
- [`docs/tts.md`](docs/tts.md)
- [`docs/storyboard-generation.md`](docs/storyboard-generation.md)

---

## 📜 License

_Add your preferred open-source license here._

---

<div align="center">

**Built With**

Ollama · Qwen 2.5 Coder · Node.js · AJV · Piper · HyperFrames · GSAP · FFmpeg

</div>
