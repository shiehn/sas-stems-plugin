/**
 * @signalsandsorcery/stems — Built-in Stems Plugin
 *
 * Generates AI audio from text prompts using the host's audio generation
 * pipeline (Lyria 3) and optionally splits the result into vocals / drums
 * / bass / other stems via the bundled stem splitter. Manages audio
 * tracks within scenes.
 */

import type { ComponentType } from 'react';
import type {
  GeneratorPlugin,
  PluginHost,
  PluginUIProps,
  PluginSettingsSchema,
  PluginSkill,
  MusicalContext,
} from '@signalsandsorcery/plugin-sdk';
import { StemsPanel } from './StemsPanel';
import stemsManifest from './plugin.json';

/** Plugin manifest (re-exported so the host registers it from the package root). */
export { stemsManifest };

export class StemsPlugin implements GeneratorPlugin {
  readonly id = '@signalsandsorcery/stems';
  readonly displayName = 'Stems';
  readonly version = '1.0.0';
  readonly description = 'AI-generated audio from text prompts, with optional stem splitting';
  readonly generatorType = 'audio' as const;
  readonly minHostVersion = '1.0.0';

  private host: PluginHost | null = null;

  async activate(host: PluginHost): Promise<void> {
    this.host = host;
    console.log('[StemsPlugin] Activated');
  }

  async deactivate(): Promise<void> {
    this.host = null;
    console.log('[StemsPlugin] Deactivated');
  }

  getUIComponent(): ComponentType<PluginUIProps> {
    return StemsPanel;
  }

  getSettingsSchema(): PluginSettingsSchema | null {
    return null;
  }

  async onSceneChanged(_sceneId: string | null): Promise<void> {
    // Audio tracks are loaded by the host on scene change
  }

  onContextChanged(_context: MusicalContext): void {
    // No action needed on context change
  }

  /**
   * LLM-callable skill: generate an ambient/textural audio bed for the
   * active scene. Mirrors what the panel's "Generate" button does — runs
   * the Lyria pipeline, writes the resulting WAV onto a new audio track,
   * and sets a sensible default volume. Discoverable through tool_search
   * via the keyword-rich description; deliberately not on the default
   * curated surface so it only surfaces when the user actually asks for
   * a texture/ambient/pad/drone/soundscape/bed.
   */
  getSkills(): PluginSkill[] {
    return [
      {
        id: 'generate_texture',
        description:
          'Generate an AI ambient audio texture from a text prompt and add it as a new audio track in the active scene. Use for ambient pads, drones, soundscapes, atmospheres, beds, foley textures, or any non-rhythmic audio bed described in natural language. The model is text-to-audio (Lyria) — describe instruments, mood, dynamics, motion ("warm shimmering pad with slow swells", "rainy city street at night", "icy drone with metallic resonance"). Returns the new track id and the path to the generated file. The user can then split the result into vocals/drums/bass/other stems via the panel\'s STEMS button. Pair with dsl_set_track_fx if the user asks for reverb / processing afterwards.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description:
                'Natural-language description of the texture (e.g. "warm analog pad with slow swells").',
            },
            durationSeconds: {
              type: 'number',
              description:
                'Optional explicit duration in seconds. Defaults to the active scene length.',
            },
            bpm: {
              type: 'number',
              description:
                'Optional target BPM. Defaults to the project BPM. Only meaningful for rhythmic textures.',
            },
            name: {
              type: 'string',
              description:
                'Optional display name for the new track. Defaults to a timestamped name.',
            },
          },
          required: ['prompt'],
        },
      },
    ];
  }
}

export default StemsPlugin;
