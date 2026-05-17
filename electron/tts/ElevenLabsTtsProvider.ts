import { TtsProvider, VoiceOption } from "./TtsProvider.js";
import { SsmlUtil } from "./SsmlUtil.js";

export class ElevenLabsTtsProvider implements TtsProvider {
  constructor(private getApiKey: () => string | undefined) {}

  async getVoices(): Promise<VoiceOption[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn("Eleven Labs API key is not configured.");
      return [];
    }

    try {
      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: {
          "xi-api-key": apiKey,
        },
      });

      if (!response.ok) {
        console.error(
          "Failed to fetch voices from Eleven Labs:",
          response.status,
          response.statusText,
        );
        return [];
      }

      const data = await (response.json() as Promise<any>);
      if (!data.voices) {
        return [];
      }

      return data.voices.map((v: any) => {
        const gender = v.labels?.gender?.toUpperCase() || "UNKNOWN";
        return {
          name: v.voice_id, // Use voice_id as the unique name identifier
          displayName: v.name, // Keep the readable name for UI
          ssmlGender: gender,
          languageCodes: ["en-US"], // Default or inferred
          provider: "elevenlabs",
          voiceId: v.voice_id,
        };
      });
    } catch (error) {
      console.error("Error fetching Eleven Labs voices:", error);
      return [];
    }
  }

  async generateSpeech(
    text: string,
    voiceOption: VoiceOption | null,
  ): Promise<Uint8Array | Buffer | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Eleven Labs API key is not configured.");
    }

    // Default to a common voice (e.g., Rachel) if no voice is provided
    const voiceId = voiceOption?.voiceId || voiceOption?.name || "21m00Tcm4TlvDq8ikWAM";
    const formattedText = SsmlUtil.formatForElevenLabs(text);

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: formattedText,
          model_id: "eleven_multilingual_v2",
        }),
      });

      if (!response.ok) {
        let errorMessage = `Eleven Labs API Error: ${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData?.detail?.message) {
            errorMessage += ` - ${errorData.detail.message}`;
          }
        } catch (e) {
          // ignore
        }
        throw new Error(errorMessage);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error: any) {
      console.error("ElevenLabs generation error:", error);
      throw error;
    }
  }
}
