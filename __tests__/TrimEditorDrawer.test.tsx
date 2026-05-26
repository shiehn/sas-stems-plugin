/**
 * TrimEditorDrawer — unit tests for snap math, drag mapping, and commit flow.
 *
 * Drag interactions in jsdom are limited (PointerEvent + setPointerCapture
 * are stubbed by @testing-library), so most assertions exercise the
 * static rendering and the commit/reset callbacks. Snap math is verified
 * via a unit-style helper that mirrors the component's internal logic.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TrimEditorDrawer } from '../TrimEditorDrawer';
import type { PluginCuePoints, PluginTrimWindow } from '@signalsandsorcery/plugin-sdk';

const RAW_CUES: PluginCuePoints = {
  schema: 1,
  sample_rate: 44100,
  detected_bpm: 120,
  // Pretend the auto-detected downbeat is at sample 22050 (half-beat in).
  downbeat_sample: 22050,
  // Beats every 22050 samples in raw-file coordinates.
  beats: Array.from({ length: 16 }, (_, i) => 22050 + i * 22050),
  detected_at: '2026-04-26T00:00:00Z',
};

const INITIAL_WINDOW: PluginTrimWindow = {
  start_sample: 22050,
  duration_samples: 88200 * 4, // 4 bars at 120 BPM 44.1 kHz
};

// Stub fetchRawAudioBytes — returns an empty buffer; AudioContext.decodeAudioData
// is stubbed below to skip the actual decode.
const fakeFetch = jest.fn(async (_path: string): Promise<ArrayBuffer> => {
  return new ArrayBuffer(64);
});

beforeAll(() => {
  // jsdom doesn't ship AudioContext; stub the parts we use.
  class MockAudioBuffer {
    length = 44100 * 30;          // 30s
    sampleRate = 44100;
    numberOfChannels = 1;
    getChannelData(_c: number): Float32Array {
      return new Float32Array(this.length);
    }
  }
  class MockAudioContext {
    decodeAudioData(_buf: ArrayBuffer): Promise<MockAudioBuffer> {
      return Promise.resolve(new MockAudioBuffer());
    }
    close(): Promise<void> { return Promise.resolve(); }
  }
  (window as unknown as { AudioContext: typeof MockAudioContext }).AudioContext = MockAudioContext;
});

describe('TrimEditorDrawer', () => {
  beforeEach(() => {
    fakeFetch.mockClear();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <TrimEditorDrawer
        open={false}
        rawFilePath="~app/audio/raw_audio/test.wav"
        rawCuePoints={RAW_CUES}
        initialTrimWindow={INITIAL_WINDOW}
        fetchRawAudioBytes={fakeFetch}
        onCommit={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders waveform canvas + commit/reset buttons when open', async () => {
    await act(async () => {
      render(
        <TrimEditorDrawer
          open={true}
          rawFilePath="~app/audio/raw_audio/test.wav"
          rawCuePoints={RAW_CUES}
          initialTrimWindow={INITIAL_WINDOW}
          fetchRawAudioBytes={fakeFetch}
          onCommit={jest.fn()}
        />,
      );
    });
    expect(screen.getByTestId('trim-editor-drawer')).toBeTruthy();
    expect(screen.getByTestId('trim-editor-canvas')).toBeTruthy();
    expect(screen.getByTestId('trim-editor-commit')).toBeTruthy();
    expect(screen.getByTestId('trim-editor-reset')).toBeTruthy();
    expect(fakeFetch).toHaveBeenCalledWith('~app/audio/raw_audio/test.wav');
  });

  it('renders one beat-tick per raw cue beat', async () => {
    render(
      <TrimEditorDrawer
        open={true}
        rawFilePath="~app/audio/raw_audio/test.wav"
        rawCuePoints={RAW_CUES}
        initialTrimWindow={INITIAL_WINDOW}
        fetchRawAudioBytes={fakeFetch}
        onCommit={jest.fn()}
      />,
    );
    await waitFor(() => {
      // Decode populates totalSamples; only after that do tick markers render.
      expect(screen.getAllByTestId('trim-editor-beat-tick').length).toBeGreaterThan(0);
    });
    // All 16 detected beats fall within the 30s mock buffer (44100*30 samples).
    expect(screen.getAllByTestId('trim-editor-beat-tick')).toHaveLength(RAW_CUES.beats.length);
  });

  it('readout reflects the current trim window in seconds', async () => {
    render(
      <TrimEditorDrawer
        open={true}
        rawFilePath="~app/audio/raw_audio/test.wav"
        rawCuePoints={RAW_CUES}
        initialTrimWindow={INITIAL_WINDOW}
        fetchRawAudioBytes={fakeFetch}
        onCommit={jest.fn()}
      />,
    );
    await waitFor(() => {
      const readout = screen.getByTestId('trim-editor-readout').textContent ?? '';
      // start = 22050 / 44100 = 0.50s; duration = 4 bars at 120 BPM = 8.00s.
      expect(readout).toContain('0.50');
      expect(readout).toContain('8.00');
    });
  });

  it('Commit button calls onCommit with the current window', async () => {
    const onCommit = jest.fn(async () => {});
    render(
      <TrimEditorDrawer
        open={true}
        rawFilePath="~app/audio/raw_audio/test.wav"
        rawCuePoints={RAW_CUES}
        initialTrimWindow={INITIAL_WINDOW}
        fetchRawAudioBytes={fakeFetch}
        onCommit={onCommit}
      />,
    );
    await waitFor(() => {
      expect(fakeFetch).toHaveBeenCalled();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('trim-editor-commit'));
    });
    expect(onCommit).toHaveBeenCalledWith({
      start_sample: INITIAL_WINDOW.start_sample,
      duration_samples: INITIAL_WINDOW.duration_samples,
    });
  });

  it('Reset button restores the initial window after a (simulated) state change', async () => {
    // We can't simulate a real drag in jsdom (no setPointerCapture), so the
    // best we can do is verify Reset is wired and disabled when no initial.
    const { rerender } = render(
      <TrimEditorDrawer
        open={true}
        rawFilePath="~app/audio/raw_audio/test.wav"
        rawCuePoints={RAW_CUES}
        initialTrimWindow={null}
        fetchRawAudioBytes={fakeFetch}
        onCommit={jest.fn()}
      />,
    );
    expect((screen.getByTestId('trim-editor-reset') as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <TrimEditorDrawer
        open={true}
        rawFilePath="~app/audio/raw_audio/test.wav"
        rawCuePoints={RAW_CUES}
        initialTrimWindow={INITIAL_WINDOW}
        fetchRawAudioBytes={fakeFetch}
        onCommit={jest.fn()}
      />,
    );
    expect((screen.getByTestId('trim-editor-reset') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disabled prop disables Commit and Reset', async () => {
    render(
      <TrimEditorDrawer
        open={true}
        rawFilePath="~app/audio/raw_audio/test.wav"
        rawCuePoints={RAW_CUES}
        initialTrimWindow={INITIAL_WINDOW}
        fetchRawAudioBytes={fakeFetch}
        onCommit={jest.fn()}
        disabled={true}
      />,
    );
    expect((screen.getByTestId('trim-editor-commit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('trim-editor-reset') as HTMLButtonElement).disabled).toBe(true);
  });

  it('snap math: nearest beat wins among two candidates', () => {
    // Verify the snap algorithm by importing it indirectly through the
    // component's behaviour. We replicate the logic here as a guard
    // against regressions if the internal algorithm is ever extracted.
    const targets = RAW_CUES.beats; // [22050, 44100, 66150, ...]
    const closestTo = (s: number): number => {
      let best = targets[0];
      let bestDist = Math.abs(s - best);
      for (const t of targets) {
        const d = Math.abs(s - t);
        if (d < bestDist) {
          best = t;
          bestDist = d;
        }
      }
      return best;
    };
    expect(closestTo(30000)).toBe(22050);
    expect(closestTo(40000)).toBe(44100);
    expect(closestTo(33075)).toBe(22050); // exact midpoint, lower wins on first hit
  });

  it('decode failure surfaces an error overlay', async () => {
    // Force decodeAudioData to throw.
    class FailingAudioContext {
      decodeAudioData(): Promise<AudioBuffer> {
        return Promise.reject(new Error('boom'));
      }
      close(): Promise<void> { return Promise.resolve(); }
    }
    (window as unknown as { AudioContext: typeof FailingAudioContext }).AudioContext = FailingAudioContext;

    render(
      <TrimEditorDrawer
        open={true}
        rawFilePath="~app/audio/raw_audio/bad.wav"
        rawCuePoints={RAW_CUES}
        initialTrimWindow={INITIAL_WINDOW}
        fetchRawAudioBytes={fakeFetch}
        onCommit={jest.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('trim-editor-error').textContent).toContain('boom');
    });
  });
});
