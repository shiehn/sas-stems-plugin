/**
 * TrimEditorDrawer — pick a new trim window inside the raw Lyria output.
 *
 * Layout (top → bottom):
 *   1. Full waveform of the raw (~30s) audio (the "outer rectangle").
 *   2. A draggable trim window (the "inner rectangle"), fixed width =
 *      current trim duration. Drag left/right to choose a different
 *      slice. Snap to detected raw-domain beats by default; hold Shift
 *      for free 1-sample resolution.
 *   3. Numeric readout (start / duration in seconds).
 *   4. Commit / Reset buttons.
 *
 * Mirrors the FX-drawer pattern used elsewhere in StemsPanel —
 * a vertically expanding panel keyed off `open`.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PluginCuePoints, PluginTrimWindow } from '@signalsandsorcery/plugin-sdk';

const CANVAS_HEIGHT_PX = 80;

export interface TrimEditorDrawerProps {
  /** When false the drawer collapses to height 0. */
  open: boolean;
  /**
   * Raw-file path (`~app/...` or `./...`). When null the drawer renders
   * an empty state — happens when an older clip has no raw metadata.
   */
  rawFilePath: string | null;
  /** Beats in raw-file sample coordinates — snap targets. */
  rawCuePoints: PluginCuePoints | null;
  /** Initial trim window inside the raw file. */
  initialTrimWindow: PluginTrimWindow | null;
  /**
   * Read raw audio bytes via the host. Returning a fresh ArrayBuffer
   * lets us decode with `AudioContext.decodeAudioData` exactly once on
   * mount (or whenever the raw path changes).
   */
  fetchRawAudioBytes: (filePath: string) => Promise<ArrayBuffer>;
  /** Commit the chosen window — caller talks to the host. */
  onCommit: (window: PluginTrimWindow) => Promise<void>;
  /** Disable interaction (e.g., during commit). */
  disabled?: boolean;
}

// Waveform peak math + canvas drawing live in the SDK's waveform toolkit so
// audio plugins (stems, recorder) render the same view without duplicating it.
import { computePeaks, drawWaveform, type WaveformPeaks } from '@signalsandsorcery/plugin-sdk';

/** ARIA label for the inner trim handle — exported for tests. */
export const TRIM_WINDOW_TESTID = 'trim-editor-window';

export function TrimEditorDrawer(props: TrimEditorDrawerProps): React.ReactElement {
  const {
    open,
    rawFilePath,
    rawCuePoints,
    initialTrimWindow,
    fetchRawAudioBytes,
    onCommit,
    disabled = false,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const [draftStart, setDraftStart] = useState<number>(
    initialTrimWindow?.start_sample ?? 0,
  );
  const [duration, setDuration] = useState<number>(
    initialTrimWindow?.duration_samples ?? 0,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // Sync draft state with prop changes (project reload, regen, etc.).
  useEffect(() => {
    if (initialTrimWindow) {
      setDraftStart(initialTrimWindow.start_sample);
      setDuration(initialTrimWindow.duration_samples);
    }
  }, [initialTrimWindow]);

  // Decode the raw file once per path. We render peaks at a coarse
  // resolution (one min/max pair per pixel column) — the canvas width
  // isn't known until layout, so we use a generous placeholder (1024)
  // and downsample further at draw-time if the rendered width differs.
  useEffect(() => {
    if (!open || !rawFilePath) return;
    let cancelled = false;
    setDecodeError(null);

    (async (): Promise<void> => {
      try {
        const bytes = await fetchRawAudioBytes(rawFilePath);
        const ctx = new (window.AudioContext || (window as unknown as {
          webkitAudioContext: typeof AudioContext
        }).webkitAudioContext)();
        // decodeAudioData consumes the buffer — pass a fresh slice.
        const audioBuffer = await ctx.decodeAudioData(bytes.slice(0));
        if (cancelled) {
          await ctx.close();
          return;
        }
        const computed = computePeaks(audioBuffer, 1024);
        await ctx.close();
        if (!cancelled) setPeaks(computed);
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn('[TrimEditor] decode failed:', err);
          setDecodeError(msg);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [open, rawFilePath, fetchRawAudioBytes]);

  // Render peaks to the canvas whenever they change or the layout shifts.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    drawWaveform(canvas, peaks);
  }, [open, peaks]);

  // Snap targets — beats in raw-file sample coordinates, plus the
  // initial start (so "Reset" lines up exactly without rounding).
  const snapTargets = useMemo<number[]>(() => {
    const out: number[] = [];
    if (rawCuePoints) {
      for (const b of rawCuePoints.beats) {
        if (Number.isInteger(b) && b >= 0) out.push(b);
      }
    }
    if (initialTrimWindow && Number.isInteger(initialTrimWindow.start_sample)) {
      out.push(initialTrimWindow.start_sample);
    }
    out.sort((a, b) => a - b);
    return out;
  }, [rawCuePoints, initialTrimWindow]);

  const totalSamples = peaks?.totalSamples ?? 0;
  const sampleRate = peaks?.sampleRate ?? rawCuePoints?.sample_rate ?? 44100;
  const maxStart = Math.max(0, totalSamples - duration);

  // Snap a candidate sample value to the nearest beat target. Linear
  // scan — beat counts are tiny (≤ 64). Returns the candidate unchanged
  // when no targets are present.
  const snapToBeat = useCallback(
    (sample: number): number => {
      if (snapTargets.length === 0) return sample;
      let best = snapTargets[0];
      let bestDist = Math.abs(sample - best);
      for (const t of snapTargets) {
        const d = Math.abs(sample - t);
        if (d < bestDist) {
          best = t;
          bestDist = d;
        }
      }
      return best;
    },
    [snapTargets],
  );

  const clampStart = useCallback(
    (s: number): number => Math.max(0, Math.min(maxStart, Math.round(s))),
    [maxStart],
  );

  // Map mouse-move client X into a desired start_sample. We anchor the
  // drag at the click offset inside the inner window so the window
  // doesn't snap to the cursor — it follows the cursor naturally.
  const dragStateRef = useRef<{ anchorClientX: number; anchorStart: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (disabled || totalSamples === 0) return;
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      track.setPointerCapture(e.pointerId);
      setIsDragging(true);
      dragStateRef.current = { anchorClientX: e.clientX, anchorStart: draftStart };

      const updateFromEvent = (clientX: number, shiftHeld: boolean): number => {
        const anchor = dragStateRef.current;
        if (!anchor) return draftStart;
        const rect = track.getBoundingClientRect();
        const dxPx = clientX - anchor.anchorClientX;
        const samplesPerPx = totalSamples / Math.max(1, rect.width);
        const raw = anchor.anchorStart + dxPx * samplesPerPx;
        const snapped = shiftHeld ? raw : snapToBeat(raw);
        return clampStart(snapped);
      };

      setDraftStart(updateFromEvent(e.clientX, e.shiftKey));

      const onMove = (ev: PointerEvent): void => {
        setDraftStart(updateFromEvent(ev.clientX, ev.shiftKey));
      };
      const onUp = (ev: PointerEvent): void => {
        const final = updateFromEvent(ev.clientX, ev.shiftKey);
        track.releasePointerCapture(e.pointerId);
        track.removeEventListener('pointermove', onMove);
        track.removeEventListener('pointerup', onUp);
        track.removeEventListener('pointercancel', onUp);
        setIsDragging(false);
        setDraftStart(final);
        dragStateRef.current = null;
      };

      track.addEventListener('pointermove', onMove);
      track.addEventListener('pointerup', onUp);
      track.addEventListener('pointercancel', onUp);
    },
    [disabled, draftStart, totalSamples, snapToBeat, clampStart],
  );

  const handleReset = useCallback((): void => {
    if (!initialTrimWindow) return;
    setDraftStart(initialTrimWindow.start_sample);
    setDuration(initialTrimWindow.duration_samples);
  }, [initialTrimWindow]);

  const handleCommit = useCallback(async (): Promise<void> => {
    if (disabled || isCommitting) return;
    setIsCommitting(true);
    try {
      await onCommit({ start_sample: draftStart, duration_samples: duration });
    } finally {
      setIsCommitting(false);
    }
  }, [disabled, isCommitting, onCommit, draftStart, duration]);

  // Window position as percentages — scales with canvas width.
  const windowLeftPct = totalSamples > 0
    ? `${((draftStart / totalSamples) * 100).toFixed(2)}%`
    : '0%';
  const windowWidthPct = totalSamples > 0
    ? `${((duration / totalSamples) * 100).toFixed(2)}%`
    : '0%';

  // Beat tick markers — same coordinate system as the trim window.
  const beatTicks = useMemo(() => {
    if (!rawCuePoints || totalSamples === 0) return [];
    return rawCuePoints.beats
      .filter((b) => b >= 0 && b <= totalSamples)
      .map((b) => ({ sample: b, leftPct: (b / totalSamples) * 100 }));
  }, [rawCuePoints, totalSamples]);

  if (!open) return <></>;

  const startSeconds = draftStart / sampleRate;
  const durationSeconds = duration / sampleRate;

  return (
    <div
      data-testid="trim-editor-drawer"
      className="bg-sas-bg/40 border-t border-sas-border px-3 py-3 flex flex-col gap-2"
    >
      {/* Outer rectangle: full waveform + trim window overlay */}
      <div
        ref={trackRef}
        data-testid="trim-editor-track"
        onPointerDown={handlePointerDown}
        className={`relative w-full bg-sas-bg rounded-sm overflow-hidden select-none ${
          disabled || totalSamples === 0 ? 'cursor-not-allowed opacity-60' : 'cursor-grab'
        } ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{ height: CANVAS_HEIGHT_PX }}
        role="slider"
        aria-label="Trim window position"
        aria-valuemin={0}
        aria-valuemax={maxStart}
        aria-valuenow={draftStart}
        aria-disabled={disabled || totalSamples === 0}
      >
        <canvas
          ref={canvasRef}
          data-testid="trim-editor-canvas"
          className="absolute inset-0 w-full h-full"
        />
        {/* Beat tick markers */}
        {beatTicks.map((t) => (
          <div
            key={t.sample}
            aria-hidden="true"
            data-testid="trim-editor-beat-tick"
            className="absolute top-0 bottom-0 w-px bg-sas-accent/30"
            style={{ left: `${t.leftPct.toFixed(2)}%` }}
          />
        ))}
        {/* Inner trim window */}
        {totalSamples > 0 && (
          <div
            data-testid={TRIM_WINDOW_TESTID}
            aria-hidden="true"
            className={`absolute top-0 bottom-0 border-2 ${
              isDragging
                ? 'border-sas-accent bg-sas-accent/10'
                : 'border-sas-accent/80 bg-sas-accent/5'
            }`}
            style={{ left: windowLeftPct, width: windowWidthPct }}
          />
        )}
        {decodeError && (
          <div
            data-testid="trim-editor-error"
            className="absolute inset-0 flex items-center justify-center text-[10px] text-amber-400"
          >
            Failed to decode audio: {decodeError}
          </div>
        )}
      </div>

      {/* Readout + buttons */}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span
          data-testid="trim-editor-readout"
          className="text-sas-muted/80 tabular-nums"
        >
          start {startSeconds.toFixed(2)}s · duration {durationSeconds.toFixed(2)}s
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="trim-editor-reset"
            onClick={handleReset}
            disabled={disabled || isCommitting || !initialTrimWindow}
            className="px-2 py-0.5 rounded-sm border border-sas-border text-sas-muted/80 hover:border-sas-accent hover:text-sas-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Reset
          </button>
          <button
            type="button"
            data-testid="trim-editor-commit"
            onClick={handleCommit}
            disabled={disabled || isCommitting || totalSamples === 0}
            className="px-2 py-0.5 rounded-sm bg-sas-accent text-sas-bg hover:bg-sas-accent/90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isCommitting ? 'Committing…' : 'Commit'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compute one min/max pair per output bin from the channel-mixed buffer.
 * Mono: the single channel's samples. Stereo+: average across channels.
 * Output is laid out as `[min, max, min, max, ...]` so the canvas
 * renderer can read pairs sequentially without index math.
 */
export default TrimEditorDrawer;
