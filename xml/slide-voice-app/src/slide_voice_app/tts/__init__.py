"""TTS provider module for slide-voice-app."""

from slide_voice_app.tts.google import GoogleTTSProvider
from slide_voice_app.tts.provider import TTSProvider, Voice

__all__ = ["GoogleTTSProvider", "TTSProvider", "Voice"]
