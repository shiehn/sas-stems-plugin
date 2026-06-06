/**
 * Tests for STEMS button in StemsPanel
 *
 * Tests:
 * - STEMS button renders when stem splitter is available
 * - STEMS button does not render when splitter is unavailable
 * - STEMS button is disabled during generation or splitting
 * - Clicking STEMS triggers host.splitStems()
 * - Splitting progress overlay shown during split
 * - Stem tracks added to UI after successful split
 * - Original track auto-muted after split
 * - Error toast shown on split failure
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { PluginHost, PluginTrackHandle } from '@signalsandsorcery/plugin-sdk';

// Mock the SDK package used by StemsPanel
jest.mock('@signalsandsorcery/plugin-sdk', () => ({
  VolumeSlider: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <input data-testid="volume-slider" type="range" value={value} onChange={(e) => onChange(Number(e.target.value))} />
  ),
  PanSlider: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <input data-testid="pan-slider" type="range" value={value} onChange={(e) => onChange(Number(e.target.value))} />
  ),
  FxToggleBar: () => <div data-testid="fx-toggle-bar" />,
  SorceryProgressBar: ({ statusText }: { isLoading: boolean; statusText: string; heightClass: string }) => (
    <div data-testid="progress-bar">{statusText}</div>
  ),
  EMPTY_FX_DETAIL_STATE: {
    eq: { enabled: false, presetIndex: 0, dryWet: 1.0 },
    compressor: { enabled: false, presetIndex: 0, dryWet: 1.0 },
    chorus: { enabled: false, presetIndex: 0, dryWet: 1.0 },
    phaser: { enabled: false, presetIndex: 0, dryWet: 1.0 },
    delay: { enabled: false, presetIndex: 0, dryWet: 1.0 },
    reverb: { enabled: false, presetIndex: 0, dryWet: 1.0 },
  },
  // ConfirmDialog guards track deletion; honor `open` so closed dialogs render
  // nothing (existing tests never open it) and expose the testids the new
  // delete-confirmation tests below drive.
  ConfirmDialog: ({
    open,
    message,
    confirmLabel,
    onConfirm,
    onCancel,
    testIdPrefix = 'confirm-dialog',
  }: {
    open: boolean;
    message: React.ReactNode;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    testIdPrefix?: string;
  }) =>
    open ? (
      <div data-testid={`${testIdPrefix}-modal`}>
        <div data-testid={`${testIdPrefix}-message`}>{message}</div>
        <button data-testid={`${testIdPrefix}-confirm`} onClick={onConfirm}>
          {confirmLabel ?? 'Delete'}
        </button>
        <button data-testid={`${testIdPrefix}-cancel`} onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}));

jest.mock('react-icons/gi', () => ({
  GiSoundWaves: () => <span data-testid="wave-icon" />,
}));

import { StemsPanel } from '../StemsPanel';

// ---------------------------------------------------------------------------
// Mock host factory
// ---------------------------------------------------------------------------

function makeHandle(id: string, name: string): PluginTrackHandle {
  return { id, name, dbId: `db-${id}`, role: undefined, prompt: undefined };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const fn = (): jest.Mock<any> => jest.fn<any>();

function makeMockHost(overrides?: Record<string, any>): PluginHost {
  const defaultTracks = [makeHandle('track-1', 'audio-123456')];

  const base: Record<string, any> = {
    createTrack: fn().mockResolvedValue(makeHandle('new-track', 'new')),
    deleteTrack: fn().mockResolvedValue(undefined),
    getPluginTracks: fn().mockResolvedValue(defaultTracks),
    adoptSceneTracks: fn().mockResolvedValue([]),
    getTrackInfo: fn().mockResolvedValue({
      id: 'track-1', name: 'audio-123456', dbId: 'db-track-1',
      muted: false, soloed: false, volume: 0.75, pan: 0,
      plugins: [], hasMidi: false, hasAudio: true,
    }),
    setTrackMute: fn().mockResolvedValue(undefined),
    setTrackVolume: fn().mockResolvedValue(undefined),
    setTrackPan: fn().mockResolvedValue(undefined),
    setTrackSolo: fn().mockResolvedValue(undefined),
    setTrackName: fn().mockResolvedValue(undefined),
    shufflePreset: fn().mockResolvedValue({}),
    duplicateTrack: fn().mockResolvedValue(makeHandle('dup', 'dup')),

    getTrackFxState: fn().mockResolvedValue({
      eq: { enabled: false, presetIndex: 0, dryWet: 1.0 },
      compressor: { enabled: false, presetIndex: 0, dryWet: 1.0 },
      chorus: { enabled: false, presetIndex: 0, dryWet: 0.5 },
      phaser: { enabled: false, presetIndex: 0, dryWet: 0.5 },
      delay: { enabled: false, presetIndex: 0, dryWet: 0.3 },
      reverb: { enabled: false, presetIndex: 0, dryWet: 0.3 },
    }),
    toggleTrackFx: fn().mockResolvedValue(undefined),
    setTrackFxPreset: fn().mockResolvedValue({}),
    setTrackFxDryWet: fn().mockResolvedValue(undefined),

    onTrackStateChange: fn().mockReturnValue(() => {}),
    onTransportEvent: fn().mockReturnValue(() => {}),
    onDeckBoundary: fn().mockReturnValue(() => {}),
    onSceneChange: fn().mockReturnValue(() => {}),
    onEngineReady: fn().mockReturnValue(() => {}),
    onComposeProgress: fn().mockReturnValue(() => {}),

    getGenerationContext: fn().mockResolvedValue({}),
    getMusicalContext: fn().mockResolvedValue({}),
    getActiveSceneId: fn().mockReturnValue('scene-1'),
    getSceneList: fn().mockResolvedValue([]),
    getTransportState: fn().mockResolvedValue({}),

    generateWithLLM: fn().mockResolvedValue({}),
    isLLMAvailable: fn().mockResolvedValue(false),

    getPresetCategories: fn().mockResolvedValue([]),
    getRandomPreset: fn().mockResolvedValue(null),
    getPresetByName: fn().mockResolvedValue(null),
    classifyPresetCategory: fn().mockResolvedValue('other'),

    getDataDirectory: fn().mockReturnValue('/tmp/test'),
    settings: {
      get: fn().mockReturnValue(undefined),
      set: fn().mockResolvedValue(undefined),
      getAll: fn().mockReturnValue({}),
    },

    getSceneData: fn().mockResolvedValue(null),
    setSceneData: fn().mockResolvedValue(undefined),
    getAllSceneData: fn().mockResolvedValue({}),
    deleteSceneData: fn().mockResolvedValue(undefined),
    getProjectData: fn().mockResolvedValue(null),
    setProjectData: fn().mockResolvedValue(undefined),

    showToast: fn(),
    setProgress: fn(),
    setStatusMessage: fn(),
    confirmAction: fn().mockResolvedValue(true),

    showOpenDialog: fn().mockResolvedValue(null),
    showSaveDialog: fn().mockResolvedValue(null),
    downloadFile: fn().mockResolvedValue(''),
    importFile: fn().mockResolvedValue(''),

    httpRequest: fn().mockResolvedValue({ status: 200, headers: {}, body: '' }),
    storeSecret: fn().mockResolvedValue(undefined),
    getSecret: fn().mockResolvedValue(null),
    deleteSecret: fn().mockResolvedValue(undefined),

    getSamples: fn().mockResolvedValue([]),
    getSampleById: fn().mockResolvedValue(null),
    importSamples: fn().mockResolvedValue({ imported: [], errors: [] }),
    createSampleTrack: fn().mockResolvedValue(makeHandle('s', 's')),
    deleteSampleTrack: fn().mockResolvedValue(undefined),
    getPluginSampleTracks: fn().mockResolvedValue([]),
    timeStretchSample: fn().mockResolvedValue({}),

    generateAudioTexture: fn().mockResolvedValue({ filePath: '/tmp/audio.wav', durationSeconds: 10, cuePoints: null }),

    // Migration 060: cue points + offset alignment. Mocks return safe
    // defaults so the panel's loadTracks() doesn't log warnings.
    setCuePoints: fn().mockResolvedValue(undefined),
    getCuePoints: fn().mockResolvedValue(null),
    setAudioOffsetSamples: fn().mockResolvedValue(undefined),
    getAudioOffsetSamples: fn().mockResolvedValue(0),

    writeMidiClip: fn().mockResolvedValue({ clipId: '1', notesWritten: 0 }),
    clearMidi: fn().mockResolvedValue(undefined),
    postProcessMidi: fn().mockResolvedValue([]),

    loadSynthPlugin: fn().mockResolvedValue(0),
    setPluginState: fn().mockResolvedValue(undefined),
    getPluginState: fn().mockResolvedValue(''),
    getTrackPlugins: fn().mockResolvedValue([]),
    removePlugin: fn().mockResolvedValue(undefined),
    isPluginAvailable: fn().mockResolvedValue(true),

    getAvailableInstruments: fn().mockResolvedValue([]),
    getTrackInstrument: fn().mockResolvedValue(null),
    setTrackInstrument: fn().mockResolvedValue(undefined),
    showInstrumentEditor: fn().mockResolvedValue(undefined),
    hideInstrumentEditor: fn().mockResolvedValue(undefined),

    composeScene: fn().mockResolvedValue({ success: true, tracksCreated: 0 }),
    auditionNote: fn().mockResolvedValue(undefined),

    getPluginPresets: fn().mockResolvedValue([]),
    savePluginPreset: fn().mockResolvedValue({}),
    deletePluginPreset: fn().mockResolvedValue(undefined),

    logMetric: fn(),
    startTimer: fn().mockReturnValue(() => {}),

    splitStems: fn().mockResolvedValue({ stems: [] }),
    isStemSplitterAvailable: fn().mockResolvedValue(false),
  };

  return { ...base, ...overrides } as unknown as PluginHost;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const defaultSceneContext: any = {
  hasContract: true,
  contractPrompt: 'test prompt',
  genre: null,
  key: 'C',
  chords: [],
  bpm: 120,
  bars: 4,
  mode: 'major',
  timeSignature: '4/4',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StemsPanel - STEMS button', () => {
  it('should NOT render STEMS button when splitter is unavailable', async () => {
    const host = makeMockHost({
      isStemSplitterAvailable: fn().mockResolvedValue(false),
    });

    await act(async () => {
      render(
        <StemsPanel
          host={host}
          activeSceneId="scene-1"
          isAuthenticated={true}
          isConnected={true}
          sceneContext={defaultSceneContext}
        />
      );
    });

    // Wait for tracks to load
    await waitFor(() => {
      expect(screen.getByTestId('audio-section')).toBeTruthy();
    });

    expect(screen.queryByTestId('audio-stems-button')).toBeNull();
  });

  it('should render STEMS button when splitter is available', async () => {
    const host = makeMockHost({
      isStemSplitterAvailable: fn().mockResolvedValue(true),
    });

    await act(async () => {
      render(
        <StemsPanel
          host={host}
          activeSceneId="scene-1"
          isAuthenticated={true}
          isConnected={true}
          sceneContext={defaultSceneContext}
        />
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('audio-stems-button')).toBeTruthy();
    });

    expect(screen.getByTestId('audio-stems-button').textContent).toBe('STEMS');
  });

  it('should call host.splitStems when STEMS button is clicked', async () => {
    const splitStemsMock = fn().mockResolvedValue({
      stems: [
        { stemType: 'vocals', track: makeHandle('stem-vocals', 'audio-123456 (vocals)') },
        { stemType: 'drums', track: makeHandle('stem-drums', 'audio-123456 (drums)') },
        { stemType: 'bass', track: makeHandle('stem-bass', 'audio-123456 (bass)') },
        { stemType: 'other', track: makeHandle('stem-other', 'audio-123456 (other)') },
      ],
    });

    const host = makeMockHost({
      isStemSplitterAvailable: fn().mockResolvedValue(true),
      splitStems: splitStemsMock,
    });

    await act(async () => {
      render(
        <StemsPanel
          host={host}
          activeSceneId="scene-1"
          isAuthenticated={true}
          isConnected={true}
          sceneContext={defaultSceneContext}
        />
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('audio-stems-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-stems-button'));
    });

    // Wait for the split to complete
    await waitFor(() => {
      expect(splitStemsMock).toHaveBeenCalledWith('track-1');
    });
  });

  it('should add stem tracks to UI after successful split', async () => {
    const splitStemsMock = fn().mockResolvedValue({
      stems: [
        { stemType: 'vocals', track: makeHandle('stem-vocals', 'audio-123456 (vocals)') },
        { stemType: 'drums', track: makeHandle('stem-drums', 'audio-123456 (drums)') },
        { stemType: 'bass', track: makeHandle('stem-bass', 'audio-123456 (bass)') },
        { stemType: 'other', track: makeHandle('stem-other', 'audio-123456 (other)') },
      ],
    });

    const host = makeMockHost({
      isStemSplitterAvailable: fn().mockResolvedValue(true),
      splitStems: splitStemsMock,
    });

    await act(async () => {
      render(
        <StemsPanel
          host={host}
          activeSceneId="scene-1"
          isAuthenticated={true}
          isConnected={true}
          sceneContext={defaultSceneContext}
        />
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('audio-stems-button')).toBeTruthy();
    });

    // Initially 1 track
    let trackRows = screen.getAllByTestId('audio-track-input-wrapper');
    expect(trackRows).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-stems-button'));
    });

    // After split: 1 original + 4 stems = 5 tracks
    await waitFor(() => {
      trackRows = screen.getAllByTestId('audio-track-input-wrapper');
      expect(trackRows).toHaveLength(5);
    });
  });

  it('should show success toast after split', async () => {
    const showToastMock = fn();
    const host = makeMockHost({
      isStemSplitterAvailable: fn().mockResolvedValue(true),
      splitStems: fn().mockResolvedValue({
        stems: [
          { stemType: 'vocals', track: makeHandle('v', 'v') },
        ],
      }),
      showToast: showToastMock,
    });

    await act(async () => {
      render(
        <StemsPanel
          host={host}
          activeSceneId="scene-1"
          isAuthenticated={true}
          isConnected={true}
          sceneContext={defaultSceneContext}
        />
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('audio-stems-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-stems-button'));
    });

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith('success', 'Stems separated', expect.any(String));
    });
  });

  it('should show error toast on split failure', async () => {
    const showToastMock = fn();
    const host = makeMockHost({
      isStemSplitterAvailable: fn().mockResolvedValue(true),
      splitStems: fn().mockRejectedValue(new Error('Model not found')),
      showToast: showToastMock,
    });

    await act(async () => {
      render(
        <StemsPanel
          host={host}
          activeSceneId="scene-1"
          isAuthenticated={true}
          isConnected={true}
          sceneContext={defaultSceneContext}
        />
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('audio-stems-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-stems-button'));
    });

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith('error', 'Stem split failed', 'Model not found');
    });
  });
});

describe('StemsPanel - generated track is muted by default', () => {
  it('mutes a newly generated audio track (matches the synth generator)', async () => {
    const setTrackMuteMock = fn().mockResolvedValue(undefined);
    const host = makeMockHost({
      // Seed the track's description so handleGenerate doesn't early-return.
      getAllSceneData: fn().mockResolvedValue({
        'track:db-track-1:description': 'warm analog pad',
      }),
      // generate()'s outer-try calls these; mock so the success path runs.
      writeAudioClip: fn().mockResolvedValue(undefined),
      setTrackMute: setTrackMuteMock,
      // Inner-try raw-metadata calls — mocked to avoid console noise.
      setRawAudioFilePath: fn().mockResolvedValue(undefined),
      setRawCuePoints: fn().mockResolvedValue(undefined),
      setTrimWindow: fn().mockResolvedValue(undefined),
    });

    await act(async () => {
      render(
        <StemsPanel
          host={host}
          activeSceneId="scene-1"
          isAuthenticated={true}
          isConnected={true}
          sceneContext={defaultSceneContext}
        />
      );
    });

    // Track loads with its seeded description shown in the input.
    await waitFor(() => {
      expect(
        (screen.getByTestId('audio-description-input') as HTMLInputElement).value
      ).toBe('warm analog pad');
    });

    // Enter in the description input triggers generation (StemRow.handleKeyDown).
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('audio-description-input'), { key: 'Enter' });
    });

    // The freshly generated track is muted by default, like the synth generator.
    await waitFor(() => {
      expect(setTrackMuteMock).toHaveBeenCalledWith('track-1', true);
    });
  });
});

describe('StemsPanel - delete confirmation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function renderWithOneTrack(): Promise<jest.Mock<any>> {
    const deleteTrack = fn().mockResolvedValue(undefined);
    const host = makeMockHost({ deleteTrack });
    await act(async () => {
      render(
        <StemsPanel
          host={host}
          activeSceneId="scene-1"
          isAuthenticated={true}
          isConnected={true}
          sceneContext={defaultSceneContext}
        />
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('audio-delete-button')).toBeTruthy();
    });
    return deleteTrack;
  }

  it('clicking "x" opens a confirm dialog WITHOUT deleting yet', async () => {
    const deleteTrack = await renderWithOneTrack();

    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-delete-button'));
    });

    expect(deleteTrack).not.toHaveBeenCalled();
    expect(screen.getByTestId('audio-delete-confirm-modal')).toBeTruthy();
  });

  it('confirming deletes the track exactly once', async () => {
    const deleteTrack = await renderWithOneTrack();

    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-delete-button'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-delete-confirm-confirm'));
    });

    await waitFor(() => {
      expect(deleteTrack).toHaveBeenCalledTimes(1);
    });
    expect(deleteTrack).toHaveBeenCalledWith('track-1');
  });

  it('cancelling does NOT delete and closes the dialog', async () => {
    const deleteTrack = await renderWithOneTrack();

    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-delete-button'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-delete-confirm-cancel'));
    });

    expect(deleteTrack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('audio-delete-confirm-modal')).toBeNull();
  });
});
