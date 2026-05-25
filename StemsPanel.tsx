/**
 * StemsPanel — Real UI for the @signalsandsorcery/stems plugin
 *
 * Renders the audio track list with description input, FX controls,
 * AI generation, and stem splitting. Uses ONLY PluginHost methods —
 * no EngineContext, no window.electronAPI.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GiSoundWaves } from 'react-icons/gi';
import type { PluginUIProps, PluginTrackHandle, PluginTrackRuntimeState, PluginTrackFxDetailState, PluginFxCategoryDetailState, FxCategory, TrackFxDetailState } from '@signalsandsorcery/plugin-sdk';
import { VolumeSlider, PanSlider, FxToggleBar, SorceryProgressBar, EMPTY_FX_DETAIL_STATE } from '@signalsandsorcery/plugin-sdk';

// ============================================================================
// Constants
// ============================================================================

const MAX_TRACKS = 16;

// ============================================================================
// Types
// ============================================================================

/** Internal track state combining handle + runtime state + description */
interface AudioTrackState {
  handle: PluginTrackHandle;
  description: string;
  runtimeState: PluginTrackRuntimeState;
  fxDetailState: TrackFxDetailState;
  fxDrawerOpen: boolean;
  isGenerating: boolean;
  isSplitting: boolean;
}

// ============================================================================
// StemsPanel
// ============================================================================

export function StemsPanel({
  host,
  activeSceneId,
  isAuthenticated,
  isConnected,
  onHeaderContent,
  onLoading,
  sceneContext,
  onSelectScene,
  onOpenContract,
  onExpandSelf,
}: PluginUIProps): React.ReactElement {
  const [tracks, setTracks] = useState<AudioTrackState[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [stemSplitterAvailable, setStemSplitterAvailable] = useState(false);
  const saveTimeoutRefs = useRef<Record<string, NodeJS.Timeout>>({});
  /** Maps engine track ID → stable DB UUID for plugin_data key construction */
  const engineToDbIdRef = useRef<Map<string, string>>(new Map());

  // ─── Load tracks when scene changes ──────────────────────────────
  const loadTracks = useCallback(async (): Promise<void> => {
    if (!activeSceneId) {
      setTracks([]);
      return;
    }

    setIsLoadingTracks(true);
    try {
      await host.adoptSceneTracks();
      const handles = await host.getPluginTracks();
      const descriptions = await host.getAllSceneData(activeSceneId) as Record<string, unknown>;

      // Build engine→dbId lookup for callbacks that receive engine IDs
      const idMap = new Map<string, string>();
      for (const h of handles) { idMap.set(h.id, h.dbId); }
      engineToDbIdRef.current = idMap;

      const trackStates: AudioTrackState[] = [];
      for (const handle of handles) {
        // Get runtime state
        let runtimeState: PluginTrackRuntimeState = {
          id: handle.id,
          muted: false,
          solo: false,
          volume: 0.75,
          pan: 0,
        };
        try {
          const info = await host.getTrackInfo(handle.id);
          runtimeState = {
            id: handle.id,
            muted: info.muted,
            solo: info.soloed,
            volume: info.volume,
            pan: info.pan,
          };
        } catch {
          // Use defaults
        }

        // Get FX state
        let fxDetailState: TrackFxDetailState = { ...EMPTY_FX_DETAIL_STATE };
        try {
          const fxState = await host.getTrackFxState(handle.id);
          fxDetailState = pluginFxToToggleFx(fxState);
        } catch {
          // Use defaults
        }

        // Use stable DB UUID for plugin_data keys (engine IDs change on project reload)
        const descKey = `track:${handle.dbId}:description`;
        const description = typeof descriptions[descKey] === 'string'
          ? descriptions[descKey] as string
          : '';

        trackStates.push({
          handle,
          description,
          runtimeState,
          fxDetailState,
          fxDrawerOpen: false,
          isGenerating: false,
          isSplitting: false,
        });
      }
      setTracks(trackStates);
    } catch (error: unknown) {
      console.error('[StemsPanel] Failed to load tracks:', error);
    } finally {
      setIsLoadingTracks(false);
    }
  }, [host, activeSceneId]);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // ─── Re-adopt tracks after engine finishes loading ───────────────
  // The initial adoption may run before the full reload creates engine tracks.
  // onEngineReady fires after the synthetic projectLoaded event, when tracks exist.
  useEffect(() => {
    const unsub = host.onEngineReady(() => {
      loadTracks();
    });
    return unsub;
  }, [host, loadTracks]);

  // Keep engine→dbId ref in sync with current tracks (for newly created tracks
  // that weren't present when loadTracks last ran)
  useEffect(() => {
    const map = new Map<string, string>();
    for (const t of tracks) { map.set(t.handle.id, t.handle.dbId); }
    engineToDbIdRef.current = map;
  }, [tracks]);

  // ─── Subscribe to real-time track state changes ──────────────────
  useEffect(() => {
    const unsub = host.onTrackStateChange(
      (trackId: string, state: PluginTrackRuntimeState) => {
        setTracks(prev => prev.map(t =>
          t.handle.id === trackId ? { ...t, runtimeState: state } : t
        ));
      }
    );
    return unsub;
  }, [host]);

  // ─── Check stem splitter availability on mount ──────────────────
  useEffect(() => {
    host.isStemSplitterAvailable().then(setStemSplitterAvailable).catch(() => {});
  }, [host]);

  // ─── Cleanup save timeouts on unmount ────────────────────────────
  useEffect(() => {
    const refs = saveTimeoutRefs;
    return () => {
      for (const timeout of Object.values(refs.current)) {
        clearTimeout(timeout);
      }
    };
  }, []);

  // ─── Add track ──────────────────────────────────────────────────
  const handleAddTrack = useCallback(async (): Promise<void> => {
    if (!activeSceneId) {
      host.showToast('warning', 'Select SCENE');
      return;
    }
    if (!isConnected) {
      host.showToast('warning', 'Systems not connected');
      return;
    }
    if (!isAuthenticated) {
      host.showToast('warning', 'Sign In Required', 'Please sign in to add audio tracks');
      return;
    }
    if (tracks.length >= MAX_TRACKS) return;

    try {
      const handle = await host.createTrack({ name: `audio-${Date.now()}` });
      const newTrack: AudioTrackState = {
        handle,
        description: '',
        runtimeState: { id: handle.id, muted: false, solo: false, volume: 0.75, pan: 0 },
        fxDetailState: { ...EMPTY_FX_DETAIL_STATE },
        fxDrawerOpen: false,
        isGenerating: false,
        isSplitting: false,
      };
      setTracks(prev => [...prev, newTrack]);
      onExpandSelf?.();
      // Auto-focus the description input of the newly created track after accordion animation
      setTimeout(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>('[data-testid="audio-section"] [data-testid="audio-description-input"]');
        if (inputs.length > 0) {
          inputs[inputs.length - 1].focus();
        }
      }, 350);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      host.showToast('error', 'Failed to create track', msg);
    }
  }, [host, activeSceneId, isConnected, isAuthenticated, tracks.length, onExpandSelf]);

  // ─── Delete track ────────────────────────────────────────────────
  const handleDeleteTrack = useCallback(async (trackId: string): Promise<void> => {
    try {
      await host.deleteTrack(trackId);
      // Clean up description from scene data (use stable DB UUID for key)
      const dbId = engineToDbIdRef.current.get(trackId) ?? trackId;
      if (activeSceneId) {
        await host.deleteSceneData(activeSceneId, `track:${dbId}:description`);
      }
      setTracks(prev => prev.filter(t => t.handle.id !== trackId));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      host.showToast('error', 'Failed to delete track', msg);
    }
  }, [host, activeSceneId]);

  // ─── Update description (debounced save) ─────────────────────────
  const handleDescriptionChange = useCallback((trackId: string, description: string): void => {
    setTracks(prev => prev.map(t =>
      t.handle.id === trackId ? { ...t, description } : t
    ));

    // Debounced save to scene data (use stable DB UUID for key)
    const dbId = engineToDbIdRef.current.get(trackId) ?? trackId;
    if (saveTimeoutRefs.current[trackId]) {
      clearTimeout(saveTimeoutRefs.current[trackId]);
    }
    saveTimeoutRefs.current[trackId] = setTimeout(() => {
      if (activeSceneId) {
        host.setSceneData(activeSceneId, `track:${dbId}:description`, description).catch(() => {});
      }
    }, 500);
  }, [host, activeSceneId]);

  // ─── Generate audio ──────────────────────────────────────────────
  const handleGenerate = useCallback(async (trackId: string): Promise<void> => {
    const track = tracks.find(t => t.handle.id === trackId);
    if (!track || !track.description.trim()) return;
    if (!isAuthenticated) {
      host.showToast('warning', 'Sign In Required', 'Please sign in to generate audio');
      return;
    }

    setTracks(prev => prev.map(t =>
      t.handle.id === trackId ? { ...t, isGenerating: true } : t
    ));

    try {
      const result = await host.generateAudioTexture({ prompt: track.description });
      // Write generated audio to the track
      await host.writeAudioClip(trackId, result.filePath);
      // Set default volume to match other track types
      await host.setTrackVolume(trackId, 0.75);

      setTracks(prev => prev.map(t =>
        t.handle.id === trackId
          ? { ...t, isGenerating: false, runtimeState: { ...t.runtimeState, volume: 0.75 } }
          : t
      ));
      host.showToast('success', 'Audio generated');
    } catch (error: unknown) {
      setTracks(prev => prev.map(t =>
        t.handle.id === trackId ? { ...t, isGenerating: false } : t
      ));
      const msg = error instanceof Error ? error.message : 'Generation failed';
      host.showToast('error', 'Generation failed', msg);
    }
  }, [host, tracks, isAuthenticated]);

  // ─── Mute/Solo/Volume ────────────────────────────────────────────
  const handleMuteToggle = useCallback((trackId: string): void => {
    const track = tracks.find(t => t.handle.id === trackId);
    if (!track) return;
    const newMuted = !track.runtimeState.muted;
    // Optimistic update
    setTracks(prev => prev.map(t =>
      t.handle.id === trackId ? { ...t, runtimeState: { ...t.runtimeState, muted: newMuted } } : t
    ));
    host.setTrackMute(trackId, newMuted).catch(() => {
      setTracks(prev => prev.map(t =>
        t.handle.id === trackId ? { ...t, runtimeState: { ...t.runtimeState, muted: !newMuted } } : t
      ));
    });
  }, [host, tracks]);

  const handleSoloToggle = useCallback((trackId: string): void => {
    const track = tracks.find(t => t.handle.id === trackId);
    if (!track) return;
    const newSolo = !track.runtimeState.solo;
    setTracks(prev => prev.map(t =>
      t.handle.id === trackId ? { ...t, runtimeState: { ...t.runtimeState, solo: newSolo } } : t
    ));
    host.setTrackSolo(trackId, newSolo).catch(() => {
      setTracks(prev => prev.map(t =>
        t.handle.id === trackId ? { ...t, runtimeState: { ...t.runtimeState, solo: !newSolo } } : t
      ));
    });
  }, [host, tracks]);

  const handleVolumeChange = useCallback((trackId: string, volume: number): void => {
    setTracks(prev => prev.map(t =>
      t.handle.id === trackId ? { ...t, runtimeState: { ...t.runtimeState, volume } } : t
    ));
    host.setTrackVolume(trackId, volume).catch(() => {});
  }, [host]);

  const handlePanChange = useCallback((trackId: string, pan: number): void => {
    setTracks(prev => prev.map(t =>
      t.handle.id === trackId ? { ...t, runtimeState: { ...t.runtimeState, pan } } : t
    ));
    host.setTrackPan(trackId, pan).catch(() => {});
  }, [host]);

  // ─── FX Operations (optimistic UI) ──────────────────────────────
  const handleFxToggle = useCallback((_trackId: string, category: FxCategory, enabled: boolean): void => {
    setTracks(prev => prev.map(t =>
      t.handle.id === _trackId
        ? { ...t, fxDetailState: { ...t.fxDetailState, [category]: { ...t.fxDetailState[category], enabled } } }
        : t
    ));
    host.toggleTrackFx(_trackId, category, enabled).catch(() => {
      setTracks(prev => prev.map(t =>
        t.handle.id === _trackId
          ? { ...t, fxDetailState: { ...t.fxDetailState, [category]: { ...t.fxDetailState[category], enabled: !enabled } } }
          : t
      ));
    });
  }, [host]);

  const handleFxPresetChange = useCallback((_trackId: string, category: FxCategory, presetIndex: number): void => {
    setTracks(prev => prev.map(t =>
      t.handle.id === _trackId
        ? { ...t, fxDetailState: { ...t.fxDetailState, [category]: { ...t.fxDetailState[category], presetIndex } } }
        : t
    ));
    host.setTrackFxPreset(_trackId, category, presetIndex).then(result => {
      if (result.dryWet !== undefined) {
        setTracks(prev => prev.map(t =>
          t.handle.id === _trackId
            ? { ...t, fxDetailState: { ...t.fxDetailState, [category]: { ...t.fxDetailState[category], dryWet: result.dryWet as number } } }
            : t
        ));
      }
    }).catch(() => {});
  }, [host]);

  const handleFxDryWetChange = useCallback((_trackId: string, category: FxCategory, value: number): void => {
    setTracks(prev => prev.map(t =>
      t.handle.id === _trackId
        ? { ...t, fxDetailState: { ...t.fxDetailState, [category]: { ...t.fxDetailState[category], dryWet: value } } }
        : t
    ));
    host.setTrackFxDryWet(_trackId, category, value).catch(() => {});
  }, [host]);

  const toggleFxDrawer = useCallback((trackId: string): void => {
    setTracks(prev => prev.map(t =>
      t.handle.id === trackId ? { ...t, fxDrawerOpen: !t.fxDrawerOpen } : t
    ));
    // Refresh FX state when opening drawer
    const track = tracks.find(t => t.handle.id === trackId);
    if (track && !track.fxDrawerOpen) {
      host.getTrackFxState(trackId).then(fxState => {
        setTracks(prev => prev.map(t =>
          t.handle.id === trackId ? { ...t, fxDetailState: pluginFxToToggleFx(fxState) } : t
        ));
      }).catch(() => {});
    }
  }, [host, tracks]);

  // ─── Split stems ────────────────────────────────────────────────
  const handleSplitStems = useCallback(async (trackId: string): Promise<void> => {
    setTracks(prev => prev.map(t =>
      t.handle.id === trackId ? { ...t, isSplitting: true } : t
    ));

    try {
      const result = await host.splitStems(trackId);

      // Build new stem track states
      const newStemTracks: AudioTrackState[] = result.stems.map(stem => ({
        handle: stem.track,
        description: `${stem.stemType} stem`,
        runtimeState: { id: stem.track.id, muted: true, solo: false, volume: 0.75, pan: 0 },
        fxDetailState: { ...EMPTY_FX_DETAIL_STATE },
        fxDrawerOpen: false,
        isGenerating: false,
        isSplitting: false,
      }));

      setTracks(prev => [
        // Update original track: done splitting, now muted
        ...prev.map(t =>
          t.handle.id === trackId
            ? { ...t, isSplitting: false, runtimeState: { ...t.runtimeState, muted: true } }
            : t
        ),
        // Add stem tracks
        ...newStemTracks,
      ]);

      host.showToast('success', 'Stems separated', `Created ${result.stems.length} stem tracks (all muted)`);
    } catch (error: unknown) {
      setTracks(prev => prev.map(t =>
        t.handle.id === trackId ? { ...t, isSplitting: false } : t
      ));
      const msg = error instanceof Error ? error.message : 'Stem splitting failed';
      host.showToast('error', 'Stem split failed', msg);
    }
  }, [host]);

  // ─── Push header content (+ Add button) to accordion header ─────
  const needsContract = !sceneContext?.hasContract;
  useEffect(() => {
    if (!onHeaderContent) return;
    const addDisabled = needsContract || !isConnected || !activeSceneId || tracks.length >= MAX_TRACKS;
    onHeaderContent(
      <div className="flex gap-1">
        <button
          data-testid="add-audio-track-button"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            if (needsContract) { onOpenContract?.(); return; }
            handleAddTrack();
          }}
          className={`px-2 py-0.5 text-[10px] font-medium rounded-sm border transition-colors ${
            addDisabled
              ? 'bg-sas-panel border-sas-border text-sas-muted/50 cursor-not-allowed'
              : 'bg-sas-accent/10 border-sas-accent/30 text-sas-accent hover:bg-sas-accent/20'
          }`}
        >
          + Add
        </button>
      </div>
    );
    return () => { onHeaderContent(null); };
  }, [onHeaderContent, isConnected, activeSceneId, tracks.length, handleAddTrack, needsContract, onOpenContract]);

  // ─── Push loading state to accordion header ────────────────────────
  useEffect(() => {
    if (!onLoading) return;
    onLoading(isLoadingTracks);
    return () => { onLoading(false); };
  }, [onLoading, isLoadingTracks]);

  // ─── Render ──────────────────────────────────────────────────────

  // No scene selected
  if (!activeSceneId) {
    return (
      <div data-testid="no-scene-placeholder-audio" className="flex items-center justify-center py-8">
        <button
          onClick={() => onSelectScene?.()}
          className="text-sas-muted text-xs hover:text-sas-accent transition-colors underline underline-offset-2"
        >
          Select a Scene
        </button>
      </div>
    );
  }

  // Scene selected but no contract generated yet
  if (!sceneContext?.hasContract) {
    return (
      <div data-testid="no-contract-placeholder-audio" className="flex items-center justify-center py-8">
        <button
          onClick={() => onOpenContract?.()}
          className="text-sas-muted text-xs hover:text-sas-accent transition-colors underline underline-offset-2"
        >
          Generate a Contract
        </button>
      </div>
    );
  }

  return (
    <div data-testid="audio-section" className="p-2 space-y-2">
      {isLoadingTracks ? (
        <div className="text-sas-muted text-xs text-center py-4">Loading tracks...</div>
      ) : (
        tracks.map((track: AudioTrackState) => (
          <AudioTrackRow
            key={track.handle.id}
            track={track}
            isAuthenticated={isAuthenticated}
            stemSplitterAvailable={stemSplitterAvailable}
            onDescriptionChange={handleDescriptionChange}
            onGenerate={handleGenerate}
            onDelete={handleDeleteTrack}
            onMuteToggle={handleMuteToggle}
            onSoloToggle={handleSoloToggle}
            onVolumeChange={handleVolumeChange}
            onPanChange={handlePanChange}
            onFxToggle={handleFxToggle}
            onFxPresetChange={handleFxPresetChange}
            onFxDryWetChange={handleFxDryWetChange}
            onToggleFxDrawer={toggleFxDrawer}
            onSplitStems={handleSplitStems}
          />
        ))
      )}
    </div>
  );
}

// ============================================================================
// AudioTrackRow — inline sub-component
// ============================================================================

interface AudioTrackRowProps {
  track: AudioTrackState;
  isAuthenticated: boolean;
  stemSplitterAvailable: boolean;
  onDescriptionChange: (trackId: string, description: string) => void;
  onGenerate: (trackId: string) => void;
  onDelete: (trackId: string) => void;
  onMuteToggle: (trackId: string) => void;
  onSoloToggle: (trackId: string) => void;
  onVolumeChange: (trackId: string, volume: number) => void;
  onPanChange: (trackId: string, pan: number) => void;
  onFxToggle: (trackId: string, category: FxCategory, enabled: boolean) => void;
  onFxPresetChange: (trackId: string, category: FxCategory, presetIndex: number) => void;
  onFxDryWetChange: (trackId: string, category: FxCategory, value: number) => void;
  onToggleFxDrawer: (trackId: string) => void;
  onSplitStems: (trackId: string) => void;
}

function AudioTrackRow({
  track,
  isAuthenticated,
  stemSplitterAvailable,
  onDescriptionChange,
  onGenerate,
  onDelete,
  onMuteToggle,
  onSoloToggle,
  onVolumeChange,
  onPanChange,
  onFxToggle,
  onFxPresetChange,
  onFxDryWetChange,
  onToggleFxDrawer,
  onSplitStems,
}: AudioTrackRowProps): React.ReactElement {
  const { handle, description, runtimeState, fxDetailState, fxDrawerOpen, isGenerating, isSplitting } = track;
  const isMuted = runtimeState.muted;
  const isSoloed = runtimeState.solo;
  const currentVolume = runtimeState.volume;
  const hasFxActive = Object.values(fxDetailState).some(
    (d: { enabled: boolean }) => d.enabled
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onGenerate(handle.id);
    }
  };

  return (
    <div data-testid="audio-track-input-wrapper" className="w-full">
      <div
        data-testid="audio-track-input"
        className="relative flex items-stretch gap-1 p-2 rounded-sm border w-full overflow-hidden border-sas-border bg-sas-panel-alt"
        style={{ borderLeftColor: '#6AF2C5', borderLeftWidth: '3px' }}
      >
        {/* Generating progress overlay */}
        {isGenerating && (
          <div className="absolute inset-0 z-20">
            <SorceryProgressBar isLoading={true} statusText="GENERATING AUDIO..." heightClass="h-full" />
          </div>
        )}

        {/* Splitting stems progress overlay */}
        {isSplitting && (
          <div className="absolute inset-0 z-20">
            <SorceryProgressBar isLoading={true} statusText="SPLITTING STEMS..." heightClass="h-full" />
          </div>
        )}

        {/* Waveform icon */}
        <div className="flex items-center gap-1 flex-shrink-0 relative z-10 self-stretch">
          <div className="w-6 h-6 flex items-center justify-center bg-sas-bg rounded-sm" title="Audio Track">
            <GiSoundWaves size={18} className="text-sas-accent" />
          </div>
        </div>

        {/* Description input with volume + FX underneath */}
        <div className="flex flex-col flex-1 min-w-0 relative z-10">
          <input
            type="text"
            data-testid="audio-description-input"
            value={description}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onDescriptionChange(handle.id, e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your audio..."
            disabled={isGenerating}
            className="sas-input w-full px-2 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex items-center gap-2 mt-1">
            {handle.name && (
              <span className="text-[10px] text-sas-muted/60 truncate pl-2" title={handle.name}>
                {handle.name}
              </span>
            )}
            <VolumeSlider
              value={currentVolume}
              onChange={(vol: number) => onVolumeChange(handle.id, vol)}
              disabled={isGenerating}
              className="flex-shrink-0"
            />
            <PanSlider
              value={runtimeState.pan}
              onChange={(pan: number) => onPanChange(handle.id, pan)}
              className="w-16 flex-shrink-0"
            />
            <button
              data-testid="fx-button"
              onClick={() => onToggleFxDrawer(handle.id)}
              disabled={isGenerating}
              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-sm transition-colors border flex-shrink-0 ${
                isGenerating
                  ? 'bg-sas-panel border-sas-border text-sas-muted/30 cursor-not-allowed'
                  : fxDrawerOpen
                    ? 'bg-sas-accent border-sas-accent text-sas-bg'
                    : hasFxActive
                      ? 'bg-sas-accent/20 border-sas-accent text-sas-accent hover:bg-sas-accent hover:text-sas-bg'
                      : 'bg-sas-panel-alt border-sas-border text-sas-muted/60 hover:border-sas-accent hover:text-sas-accent'
              }`}
              title={fxDrawerOpen ? 'Hide FX controls' : 'Show FX controls'}
            >
              FX
            </button>
            {stemSplitterAvailable && (
              <button
                data-testid="audio-stems-button"
                onClick={() => onSplitStems(handle.id)}
                disabled={isGenerating || isSplitting}
                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-sm transition-colors border flex-shrink-0 ${
                  isGenerating || isSplitting
                    ? 'bg-sas-panel border-sas-border text-sas-muted/30 cursor-not-allowed'
                    : 'bg-sas-panel-alt border-sas-border text-sas-muted/60 hover:border-sas-accent hover:text-sas-accent'
                }`}
                title={isSplitting ? 'Splitting...' : 'Split into stems (vocals, drums, bass, other)'}
              >
                {isSplitting ? '...' : 'STEMS'}
              </button>
            )}
          </div>
        </div>

        {/* Generate button */}
        <button
          data-testid="audio-generate-button"
          onClick={() => onGenerate(handle.id)}
          disabled={isGenerating || !description.trim()}
          className={`w-14 rounded-sm text-xs font-medium transition-colors flex-shrink-0 relative z-10 border self-stretch flex items-center justify-center ${
            isGenerating
              ? 'bg-sas-panel border-sas-border text-sas-muted/50 cursor-not-allowed'
              : description.trim()
                ? 'bg-sas-accent/20 border-sas-accent text-sas-accent hover:bg-sas-accent hover:text-sas-bg'
                : 'bg-sas-panel border-sas-border text-sas-muted/50 cursor-not-allowed'
          }`}
          title={isGenerating ? 'Generating...' : 'Generate Audio'}
        >
          {isGenerating ? <span className="animate-spin">...</span> : 'Create'}
        </button>

        {/* Mute/Solo buttons */}
        <div className="flex flex-col gap-0.5 flex-shrink-0 relative z-10 self-stretch justify-center">
          <button
            data-testid="audio-mute-button"
            onClick={() => onMuteToggle(handle.id)}
            disabled={isGenerating}
            className={`px-1.5 py-0.5 text-xs font-bold rounded transition-colors ${
              isGenerating
                ? 'bg-sas-panel text-sas-muted/50 cursor-not-allowed'
                : isMuted
                  ? 'bg-red-600 text-white'
                  : 'bg-sas-panel-alt text-sas-muted hover:bg-sas-border'
            }`}
            title={isMuted ? 'Unmute track' : 'Mute track'}
          >
            M
          </button>
          <button
            data-testid="audio-solo-button"
            onClick={() => onSoloToggle(handle.id)}
            disabled={isGenerating}
            className={`px-1.5 py-0.5 text-xs font-bold rounded transition-colors ${
              isGenerating
                ? 'bg-sas-panel text-sas-muted/50 cursor-not-allowed'
                : isSoloed
                  ? 'bg-yellow-500 text-black'
                  : 'bg-sas-panel-alt text-sas-muted hover:bg-sas-border'
            }`}
            title={isSoloed ? 'Unsolo track' : 'Solo track'}
          >
            S
          </button>
        </div>

        {/* Delete button */}
        <button
          data-testid="audio-delete-button"
          onClick={() => onDelete(handle.id)}
          className="text-sas-danger/70 hover:text-sas-danger px-1 transition-colors relative z-10 self-stretch flex items-center"
          title="Delete track"
        >
          x
        </button>
      </div>

      {/* FX Drawer */}
      {fxDrawerOpen && (
        <div data-testid="fx-drawer" className="border border-t-0 border-sas-border bg-sas-bg rounded-b-sm px-3 py-2 max-h-[180px] overflow-y-auto">
          <FxToggleBar
            trackId={handle.id}
            fxState={fxDetailState}
            onToggle={onFxToggle}
            onPresetChange={onFxPresetChange}
            onDryWetChange={onFxDryWetChange}
            disabled={isGenerating}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert SDK PluginTrackFxDetailState to the FxToggleBar's expected TrackFxDetailState */
function pluginFxToToggleFx(sdkState: PluginTrackFxDetailState): TrackFxDetailState {
  const result = { ...EMPTY_FX_DETAIL_STATE };
  for (const category of ['eq', 'compressor', 'chorus', 'phaser', 'delay', 'reverb'] as const) {
    const sdkCat = sdkState[category] as PluginFxCategoryDetailState | undefined;
    if (sdkCat) {
      result[category] = {
        enabled: sdkCat.enabled,
        presetIndex: sdkCat.presetIndex,
        dryWet: sdkCat.dryWet,
      };
    }
  }
  return result;
}

export default StemsPanel;
