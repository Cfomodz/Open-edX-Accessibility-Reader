<div align="center">

# ♿ Accessibility Content Reader for Open edX 🔈
![Tampermonkey](https://img.shields.io/badge/Tampermonkey-UserScript-blue)
![Firefox](https://img.shields.io/badge/Firefox-✓-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active%20development-yellow)

<a href="https://github.com/Cfomodz/Open-edX-Accessibility-Reader/raw/refs/heads/main/accessibility-reader.user.js"><img src="https://github.com/user-attachments/assets/103e9c5a-46c0-473c-805c-84c4aa08994f" alt="Accessibility Content Reader screenshot" width="600"/></a>

### One-Click:
[![Install](https://img.shields.io/badge/Install-💌-black)](https://github.com/Cfomodz/Open-edX-Accessibility-Reader/raw/refs/heads/main/accessibility-reader.user.js)

</br>
</br>

## 🚀 What Is This?

A Tampermonkey userscript for Firefox that reads Open edX course content aloud and navigates through unit sequences. Built as an accessibility tool for learning platforms such as used by WGU

**remote-friendly, single-button-friendly, no fine motor control required to use!**

</div>

---

## ⌨️ Hotkeys

**You only *really* need to know `Alt + Right Arrow`** 😉 - Next page + auto‑read

## 🎮 You're done!

**Navigate to your course as normal and begin learning :)**

## ✨ Features

- **Content reading** — reads text from the main content area  
- **Text-to-Speech** — with configurable voice, rate, and pitch  
- **Pause / Resume / Stop** — full playback controls  
- **Menu navigation** — Prev/Next traversal works across Sections ➔ Subsections ➔ Units  
- **Auto‑read on navigate** — automatically begins reading when advancing to the next page  
- **Accessibility first** — remote‑friendly, single‑button friendly, no fine motor control required!  
- **Keyboard hotkeys** — configurable shortcuts for all actions  
- **Control panel** — fixed on‑screen panel showing playback state and current position  

---

## ⚙️ Advanced Options / Configuration

Edit the `CONFIG` object at the top of the script:

```javascript
const CONFIG = {
  TTS_RATE: 1.0,              // Speech rate (0.5 – 2.0)
  TTS_PITCH: 1.0,             // Speech pitch (0 – 2.0)
  TTS_PREFERRED_VOICE: '',    // Voice name, or empty for system default
  AUTO_READ_ON_NAVIGATE: true, // Read aloud after navigating to next page
  PANEL_POSITION: 'bottom-right',
  // ... hotkeys, timeouts, etc.
};
```

## ⌨️ All Hotkeys

| Key | Action |
|-----|--------|
| `Alt + Right Arrow` | Next page + auto‑read |
| `Alt + Space` | Pause / Resume |
| `Alt + S` | Stop reading |
| `Alt + R` | Re‑read current page |
| `Alt + Left Arrow` | Previous page + auto‑read |
| `Alt + M` | Toggle control panel |

## 📊 Status

This project is in active development. Content reading is functional.  
**Ask if there is something wrong. I want to help you have access to the learning resources you need.**

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Cfomodz/Open-edX-Accessibility-Reader&type=date&legend=top-left)](https://www.star-history.com/#Cfomodz/Open-edX-Accessibility-Reader&type=date&legend=top-left)

## 🤝 Contributing

Ideas, bug reports, and pull requests are welcome! Feel free to open an issue or submit a PR.

## 📜 License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.

## 🙏 Shoutouts

- [Open edX](https://open.edx.org/) – the learning platform that makes sense
- [Tampermonkey](https://www.tampermonkey.net/) – for making userscripts possible  
- [WGU](https://www.wgu.edu/) – for providing accessible education to **you**

---

<div align="center">
Made with ❤️ for accessibility
</div>
