import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, RefreshCw, Terminal, CheckCircle2, AlertCircle, Database, ArrowRight, Zap, ShieldAlert, Cpu } from 'lucide-react';

interface SimulatedObject {
  key: string;
  size: number;
  etag: string;
  isMultipart: boolean;
  status: 'pending' | 'comparing' | 'transferring' | 'completed' | 'skipped' | 'retry' | 'failed';
  progress: number;
  reason?: string;
  durationMs?: number;
}

export const SyncEngineSimulator: React.FC = () => {
  // Config state
  const [sourceBucket, setSourceBucket] = useState('production-primary-assets');
  const [destBucket, setDestBucket] = useState('dr-backup-assets');
  const [syncMode, setSyncMode] = useState<'both' | 'etag' | 'timestamp'>('both');
  const [workers, setWorkers] = useState(8);
  const [multipartThresholdMb, setMultipartThresholdMb] = useState(16);
  const [chunkSizeMb, setChunkSizeMb] = useState(8);
  const [dryRun, setDryRun] = useState(false);
  const [simulateJitter, setSimulateJitter] = useState(true);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [metrics, setMetrics] = useState({
    scanned: 0,
    transferred: 0,
    skipped: 0,
    failed: 0,
    bytesTransferred: 0,
    elapsedSeconds: 0,
  });

  const [activeObjects, setActiveObjects] = useState<SimulatedObject[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Initial demo object pool
  const SAMPLE_OBJECTS: Omit<SimulatedObject, 'status' | 'progress'>[] = [
    { key: 'database/prod_dump_20261017.sql.gz', size: 145 * 1024 * 1024, etag: '65b4c10a4e76', isMultipart: true },
    { key: 'media/4k_promotional_reel.mp4', size: 312 * 1024 * 1024, etag: '992a51f893e1', isMultipart: true },
    { key: 'static/brand-assets/logo-vector.svg', size: 24 * 1024, etag: 'match-382a9', isMultipart: false },
    { key: 'logs/nginx/access_2026_10_16.log.zst', size: 48 * 1024 * 1024, etag: '7a19c55b', isMultipart: true },
    { key: 'config/runtime-production.json', size: 12 * 1024, etag: 'newer-timestamp', isMultipart: false },
    { key: 'static/bundle.main.e48a12.js', size: 840 * 1024, etag: 'match-840k', isMultipart: false },
    { key: 'reports/q3_datacenter_audit.pdf', size: 5 * 1024 * 1024, etag: 'diff-etag', isMultipart: false },
    { key: 'firmware/ceph-osd-kernel-patch.deb', size: 28 * 1024 * 1024, etag: 'ee01889a', isMultipart: true },
  ];

  const addJsonLog = (level: string, message: string, extra?: Record<string, any>) => {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      component: 'sync_engine',
      message,
      ...(extra || {}),
    };
    setLogs((prev) => [...prev.slice(-150), JSON.stringify(payload)]);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const startSimulation = () => {
    setIsRunning(true);
    setIsFinished(false);
    setLogs([]);
    setMetrics({
      scanned: 0,
      transferred: 0,
      skipped: 0,
      failed: 0,
      bytesTransferred: 0,
      elapsedSeconds: 0,
    });

    const initialQueue: SimulatedObject[] = SAMPLE_OBJECTS.map((item) => ({
      ...item,
      status: 'pending',
      progress: 0,
    }));

    setActiveObjects(initialQueue);

    addJsonLog('INFO', 'Starting CephSync Enterprise execution', {
      source_bucket: sourceBucket,
      dest_bucket: destBucket,
      sync_mode: syncMode,
      workers,
      multipart_threshold_mb: multipartThresholdMb,
      chunk_size_mb: chunkSizeMb,
      dry_run: dryRun,
      jitter_simulation: simulateJitter,
    });

    addJsonLog('INFO', 'Indexing destination bucket objects...');
    setTimeout(() => {
      addJsonLog('INFO', 'Indexed destination inventory. 2 identical objects cached.');
    }, 400);
  };

  const stopSimulation = () => {
    setIsRunning(false);
    addJsonLog('WARNING', 'Execution halted by user.');
  };

  // Timer loop for simulation
  useEffect(() => {
    if (!isRunning) return;

    const timer = setInterval(() => {
      setMetrics((prev) => ({
        ...prev,
        elapsedSeconds: prev.elapsedSeconds + 0.5,
      }));

      setActiveObjects((prev) => {
        let allDone = true;
        let newlyTransferredBytes = 0;
        let newlyTransferredCount = 0;
        let newlySkippedCount = 0;

        const next: SimulatedObject[] = prev.map((obj): SimulatedObject => {
          if (obj.status === 'completed' || obj.status === 'skipped' || obj.status === 'failed') {
            return obj;
          }
          allDone = false;

          // Transition pending -> comparing
          if (obj.status === 'pending') {
            return { ...obj, status: 'comparing' as const };
          }

          // Transition comparing -> deciding
          if (obj.status === 'comparing') {
            if (obj.etag.startsWith('match-')) {
              newlySkippedCount++;
              addJsonLog('DEBUG', 'Skipping object (already synchronized)', {
                key: obj.key,
                reason: 'up_to_date_matching_etag',
              });
              return { ...obj, status: 'skipped' as const, progress: 100, reason: 'Matching ETag & Size' };
            }

            addJsonLog('INFO', dryRun ? '[DRY RUN] Would synchronize object' : 'Starting object transfer', {
              key: obj.key,
              size_bytes: obj.size,
              multipart: obj.isMultipart,
              reason: 'etag_mismatch_or_new',
            });

            if (dryRun) {
              newlyTransferredCount++;
              newlyTransferredBytes += obj.size;
              return { ...obj, status: 'completed' as const, progress: 100, reason: 'Dry Run OK' };
            }

            return { ...obj, status: 'transferring' as const, progress: 15 };
          }

          // Transferring progress
          if (obj.status === 'transferring') {
            // Random jitter simulation
            if (simulateJitter && obj.progress > 40 && obj.progress < 60 && Math.random() < 0.15) {
              addJsonLog('WARNING', 'Transient S3 failure (HTTP 503 SlowDown), retrying with backoff', {
                attempt: 1,
                sleep_seconds: 1.25,
                key: obj.key,
                error: 'ClientError: SlowDown',
              });
              return { ...obj, status: 'retry' as const };
            }

            const step = obj.isMultipart ? 20 : 45;
            const nextProgress = Math.min(100, obj.progress + step);

            if (nextProgress >= 100) {
              newlyTransferredCount++;
              newlyTransferredBytes += obj.size;
              addJsonLog('INFO', 'Object synchronized successfully', {
                key: obj.key,
                size_bytes: obj.size,
                multipart: obj.isMultipart,
                duration_ms: Math.floor(Math.random() * 800 + 400),
              });
              return { ...obj, status: 'completed' as const, progress: 100 };
            }

            return { ...obj, progress: nextProgress };
          }

          if (obj.status === 'retry') {
            // Recover after backoff
            return { ...obj, status: 'transferring' as const, progress: 70 };
          }

          return obj;
        });

        if (newlyTransferredCount > 0 || newlyTransferredBytes > 0 || newlySkippedCount > 0) {
          setMetrics((m) => ({
            ...m,
            scanned: m.scanned + newlyTransferredCount + newlySkippedCount,
            transferred: m.transferred + newlyTransferredCount,
            skipped: m.skipped + newlySkippedCount,
            bytesTransferred: m.bytesTransferred + newlyTransferredBytes,
          }));
        }

        if (allDone && isRunning) {
          setIsRunning(false);
          setIsFinished(true);
          addJsonLog('INFO', 'Synchronization run finished', {
            status: 'SUCCESS',
            total_scanned: 8,
            total_transferred: 6,
            total_skipped: 2,
            total_failed: 0,
          });
        }

        return next;
      });
    }, 500);

    return () => clearInterval(timer);
  }, [isRunning, dryRun, simulateJitter, syncMode]);

  const throughputMbS = metrics.elapsedSeconds > 0
    ? ((metrics.bytesTransferred / (1024 * 1024)) / metrics.elapsedSeconds).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-6">
      {/* Configuration & Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              S3 Sync Engine Live Workbench & Simulator
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Test incremental diffing, concurrent worker streaming, multipart chunking, and exponential backoff retry loops.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {!isRunning ? (
              <button
                onClick={startSimulation}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Execute Simulation</span>
              </button>
            ) : (
              <button
                onClick={stopSimulation}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md shadow-red-600/20 transition-all cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Halt Engine</span>
              </button>
            )}
          </div>
        </div>

        {/* Input Parameters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          <div>
            <label className="text-slate-400 block mb-1">Source Bucket (Ceph RGW)</label>
            <input
              type="text"
              value={sourceBucket}
              onChange={(e) => setSourceBucket(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Destination Bucket (S3/Backup)</label>
            <input
              type="text"
              value={destBucket}
              onChange={(e) => setDestBucket(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Incremental Sync Mode</label>
            <select
              value={syncMode}
              onChange={(e: any) => setSyncMode(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-amber-400"
            >
              <option value="both">Both (ETag + Timestamp + Size)</option>
              <option value="etag">ETag Only (Content Hash)</option>
              <option value="timestamp">Timestamp (LastModified)</option>
            </select>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Concurrent Workers: {workers}</label>
            <input
              type="range"
              min="2"
              max="16"
              value={workers}
              onChange={(e) => setWorkers(parseInt(e.target.value))}
              className="w-full accent-amber-400 mt-2"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between flex-wrap gap-4 text-xs">
          <div className="flex items-center space-x-6">
            <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="rounded border-slate-700 text-amber-500 focus:ring-0"
              />
              <span>Dry Run Mode (--dry-run)</span>
            </label>

            <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={simulateJitter}
                onChange={(e) => setSimulateJitter(e.target.checked)}
                className="rounded border-slate-700 text-amber-500 focus:ring-0"
              />
              <span className="flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                Simulate 503 SlowDown & Jitter Backoff
              </span>
            </label>
          </div>

          <div className="text-[11px] text-slate-400 font-mono">
            Multipart threshold: <span className="text-amber-400">{multipartThresholdMb} MB</span> | Chunk: <span className="text-amber-400">{chunkSizeMb} MB</span>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono text-xs">
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-slate-500 block text-[10px] uppercase">Objects Scanned</span>
          <span className="text-slate-200 text-lg font-bold">{metrics.scanned} / {SAMPLE_OBJECTS.length}</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-slate-500 block text-[10px] uppercase">Transferred</span>
          <span className="text-emerald-400 text-lg font-bold">{metrics.transferred}</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-slate-500 block text-[10px] uppercase">Skipped (Cached)</span>
          <span className="text-sky-400 text-lg font-bold">{metrics.skipped}</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-slate-500 block text-[10px] uppercase">Data Streamed</span>
          <span className="text-amber-400 text-lg font-bold">
            {(metrics.bytesTransferred / (1024 * 1024)).toFixed(1)} MB
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl col-span-2 md:col-span-1">
          <span className="text-slate-500 block text-[10px] uppercase">Throughput</span>
          <span className="text-cyan-400 text-lg font-bold">{throughputMbS} MB/s</span>
        </div>
      </div>

      {/* Active Object Pipeline & Worker View */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Worker Thread Queue & Object Stream
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {activeObjects.length} Managed Keys
          </span>
        </div>

        <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
          {activeObjects.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 font-mono">
              Press "Execute Simulation" to launch the concurrent sync workers.
            </div>
          ) : (
            activeObjects.map((obj) => (
              <div key={obj.key} className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs">
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                  <div className="flex items-center space-x-2 min-w-0">
                    <span className="font-mono text-slate-200 font-medium truncate">{obj.key}</span>
                    {obj.isMultipart && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-950/80 text-purple-300 border border-purple-800">
                        Multipart (8MB/part)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 font-mono text-[11px]">
                    <span className="text-slate-400">{(obj.size / (1024 * 1024)).toFixed(1)} MB</span>
                    <span
                      className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                        obj.status === 'completed'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : obj.status === 'skipped'
                          ? 'bg-sky-950 text-sky-400 border border-sky-800'
                          : obj.status === 'retry'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800 animate-pulse'
                          : obj.status === 'transferring'
                          ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {obj.status}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      obj.status === 'completed'
                        ? 'bg-emerald-400'
                        : obj.status === 'skipped'
                        ? 'bg-sky-400'
                        : obj.status === 'retry'
                        ? 'bg-amber-400'
                        : 'bg-gradient-to-r from-cyan-500 to-amber-400'
                    }`}
                    style={{ width: `${obj.progress}%` }}
                  ></div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Structured JSON Log Output */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-mono font-bold text-slate-200">
              Structured JSON Log Stream (Fluentbit / Datadog Compliant)
            </span>
          </div>
          <button
            onClick={() => setLogs([])}
            className="text-[11px] font-mono text-slate-500 hover:text-slate-300 cursor-pointer"
          >
            Clear Console
          </button>
        </div>

        <div
          ref={logContainerRef}
          className="p-4 bg-slate-950 font-mono text-[11px] leading-relaxed text-slate-300 max-h-[240px] overflow-y-auto space-y-1"
        >
          {logs.length === 0 ? (
            <div className="text-slate-600 italic">No logs emitted yet. Start the simulation to view real-time JSON log records.</div>
          ) : (
            logs.map((logStr, i) => {
              const parsed = JSON.parse(logStr);
              const isError = parsed.level === 'ERROR' || parsed.level === 'CRITICAL';
              const isWarning = parsed.level === 'WARNING';
              return (
                <div key={i} className="flex space-x-2">
                  <span className="text-slate-600 select-none">{parsed.timestamp.split('T')[1].slice(0, 12)}</span>
                  <span
                    className={`font-bold select-none ${
                      isError ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-cyan-400'
                    }`}
                  >
                    [{parsed.level}]
                  </span>
                  <span className="text-slate-300">{logStr}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
