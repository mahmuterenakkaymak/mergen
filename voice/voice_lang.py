"""Voice language for the voice scripts: Turkish or English, read from config/language.json.

03-configure-openclaw.ps1 writes that file (`voice`: "tr" | "en" | "none"). Without it the voice stays Turkish,
as before. MERGEN_VOICE_LANG=tr|en overrides it for a quick test.
"""
import json
import os

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "language.json")

# Piper voices: tr_TR-dfki is CC BY-NC-SA 4.0 (personal use only); en_US-ljspeech is trained on the public-domain
# LJ Speech dataset. Both from huggingface.co/rhasspy/piper-voices.
VOICES = {
    "tr": {
        "whisper": "tr",
        "piper": "tr_TR-dfki-medium.onnx",
        "wake_aliases": [],                       # Turkish Whisper spells it "Mergen" / "Mercen" / "Merken"
        "yes": "Efendim?",
        "code_on_screen": " (kod ekranda) ",
        "rest_on_screen": ". Devamı ekranda.",
        "code_in_message": " (kod mesajda) ",
        "rest_in_message": ". Devamı mesajda.",
        "okay": "Tamam.",
        "you": "Sen",
        "seconds": "sn",
        "transcribing": "yazıya çevirme",
        "hold": "basılı tut",
        "or_say": ' ya da "Mergen, ..." de',
        "listening": "MERGEN dinliyor",
        "quit_hint": "Çıkış: Ctrl+C",
        "not_understood": "(anlaşılamadı)",
        "bye": "Görüşürüz.",
        "states": {
            "loading": "Hazırlanıyor...", "listening": "Dinliyor", "heard": "Duydum...", "thinking": "Düşünüyor...",
            "speaking": "Konuşuyor", "off": "Ses kapalı", "error": "Hata - log'a bak",
        },
        "menu_toggle": "Dinlemeyi aç / kapat",
        "menu_last": "Son konuşmayı göster",
        "menu_log": "Log klasörünü aç",
        "menu_quit": "Çıkış",
        "last_title": "MERGEN - son konuşma",
    },
    "en": {
        "whisper": "en",
        "piper": "en_US-ljspeech-medium.onnx",
        # English Whisper may write the name as an English word; untested with a real mic - extend if it misses.
        "wake_aliases": ["morgan", "mergan", "mergin", "merkin"],
        "yes": "Yes?",
        "code_on_screen": " (code on screen) ",
        "rest_on_screen": ". The rest is on screen.",
        "code_in_message": " (code in the message) ",
        "rest_in_message": ". The rest is in the message.",
        "okay": "Okay.",
        "you": "You",
        "seconds": "s",
        "transcribing": "transcription",
        "hold": "hold",
        "or_say": ' or say "Mergen, ..."',
        "listening": "MERGEN is listening",
        "quit_hint": "Quit: Ctrl+C",
        "not_understood": "(not understood)",
        "bye": "Bye.",
        "states": {
            "loading": "Starting...", "listening": "Listening", "heard": "Heard you...", "thinking": "Thinking...",
            "speaking": "Speaking", "off": "Voice off", "error": "Error - see the log",
        },
        "menu_toggle": "Listening on / off",
        "menu_last": "Show the last exchange",
        "menu_log": "Open the log folder",
        "menu_quit": "Quit",
        "last_title": "MERGEN - last exchange",
    },
}


def voice_code() -> str:
    """'tr', 'en' or 'none'."""
    code = os.environ.get("MERGEN_VOICE_LANG", "").strip().lower()
    if not code:
        try:
            with open(CONFIG, encoding="utf-8-sig") as f:       # PowerShell 5.1 writes UTF-8 with a BOM
                code = str(json.load(f).get("voice", "tr")).lower()
        except (OSError, ValueError):
            code = "tr"
    return code if code in ("tr", "en", "none") else "tr"


CODE = voice_code()
T = VOICES["en" if CODE == "en" else "tr"]       # "none": the strings are still needed by the CLIs and the widget
PIPER_VOICE = os.path.join(MODELS_DIR, T["piper"])
