/**
 * @signalsandsorcery/stems — Built-in Stems Plugin
 *
 * Generates AI audio stems from text prompts using the host's audio
 * generation pipeline (Lyria 3), then optionally splits the result into
 * vocals/drums/bass/other via the stem splitter. Manages audio tracks
 * within scenes.
 */

import type { ComponentType } from 'react';
import type {
  GeneratorPlugin,
  PluginHost,
  PluginUIProps,
  PluginSettingsSchema,
  MusicalContext,
} from '@signalsandsorcery/plugin-sdk';
import { StemsPanel } from './StemsPanel';

export class StemsPlugin implements GeneratorPlugin {
  readonly id = '@signalsandsorcery/stems';
  readonly displayName = 'Stems';
  readonly version = '1.0.0';
  readonly description = 'AI-generated audio stems from text prompts';
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
}

export default StemsPlugin;
