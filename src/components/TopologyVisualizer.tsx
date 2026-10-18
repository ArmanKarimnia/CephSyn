import React, { useState } from 'react';
import { Server, Database, ArrowRight, Shield, Layers, HardDrive, Cpu, Activity, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

export const TopologyVisualizer: React.FC = () => {
  const [selectedElement, setSelectedElement] = useState<string>('rgw-cluster');

  return (
    <div className="space-y-6">
      {/* Topology Diagram Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyan-400" />
              Ceph RGW 3-Node Multi-Site & Sync Architecture
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Click any tier in the diagram below to inspect daemon states, pool configurations, and network flows.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-800/80 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              QUORUM: 3/3 OK
            </span>
          </div>
        </div>

        {/* Diagram Flow */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
          
          {/* Primary Ceph Storage Tier */}
          <div
            onClick={() => setSelectedElement('rgw-cluster')}
            className={`xl:col-span-6 rounded-xl p-5 border cursor-pointer transition-all ${
              selectedElement === 'rgw-cluster'
                ? 'bg-slate-800/90 border-cyan-500 shadow-lg shadow-cyan-500/10'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Primary Ceph 3-Node Cluster
                </span>
              </div>
              <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                Realm: production-realm
              </span>
            </div>

            {/* 3 Node Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { name: 'ceph-node01', ip: '192.168.10.11', daemons: ['MON', 'MGR', 'OSD', 'RGW-1'] },
                { name: 'ceph-node02', ip: '192.168.10.12', daemons: ['MON', 'MGR', 'OSD', 'RGW-2'] },
                { name: 'ceph-node03', ip: '192.168.10.13', daemons: ['MON', 'MGR', 'OSD', 'RGW-3'] },
              ].map((node) => (
                <div key={node.name} className="bg-slate-900 border border-slate-800/90 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono font-bold text-slate-200">{node.name}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mb-2">{node.ip}</div>
                  <div className="flex flex-wrap gap-1">
                    {node.daemons.map((d) => (
                      <span
                        key={d}
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                          d.startsWith('RGW')
                            ? 'bg-cyan-950/80 text-cyan-300 border-cyan-700'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Ingress / VIP Layer */}
            <div className="mt-4 bg-slate-900/90 border border-dashed border-cyan-800/70 rounded-lg p-3 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-200">Cephadm Ingress HAProxy + Keepalived VIP</span>
                <p className="text-[11px] text-slate-400 font-mono">192.168.10.100:80 / 443 (Round-Robin to Beast Frontends)</p>
              </div>
              <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">
                Active VIP
              </span>
            </div>
          </div>

          {/* Sync Engine Middleware Tier */}
          <div
            onClick={() => setSelectedElement('sync-engine')}
            className={`xl:col-span-3 rounded-xl p-5 border cursor-pointer transition-all flex flex-col justify-between ${
              selectedElement === 'sync-engine'
                ? 'bg-slate-800/90 border-amber-500 shadow-lg shadow-amber-500/10'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    CephSync Python Engine
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-400 bg-amber-950 px-2 py-0.5 rounded border border-amber-800">
                  boto3 async
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Zero-disk incremental sync runner executed via Cron or GitHub Actions.
              </p>

              <div className="space-y-2 text-xs font-mono">
                <div className="bg-slate-900 p-2 rounded border border-slate-800 flex items-center justify-between">
                  <span className="text-slate-400">Concurrency:</span>
                  <span className="text-slate-200 font-bold">12 Workers</span>
                </div>
                <div className="bg-slate-900 p-2 rounded border border-slate-800 flex items-center justify-between">
                  <span className="text-slate-400">Multipart Chunk:</span>
                  <span className="text-slate-200 font-bold">8 MB / part</span>
                </div>
                <div className="bg-slate-900 p-2 rounded border border-slate-800 flex items-center justify-between">
                  <span className="text-slate-400">Backoff Strategy:</span>
                  <span className="text-slate-200 font-bold">Full Jitter</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Telemetry:</span>
              <span className="font-mono text-cyan-400">Structured JSONL</span>
            </div>
          </div>

          {/* Backup / Disaster Recovery Destination */}
          <div
            onClick={() => setSelectedElement('backup-target')}
            className={`xl:col-span-3 rounded-xl p-5 border cursor-pointer transition-all flex flex-col justify-between ${
              selectedElement === 'backup-target'
                ? 'bg-slate-800/90 border-indigo-500 shadow-lg shadow-indigo-500/10'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    Backup Target
                  </span>
                </div>
                <span className="text-[10px] font-mono text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-800">
                  DR Destination
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Secondary offsite Ceph RGW cluster or Amazon S3 / S3-compatible cloud storage.
              </p>

              <div className="space-y-2 text-xs font-mono">
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <div className="text-slate-500 text-[10px]">Bucket:</div>
                  <div className="text-slate-200 truncate">dr-backup-assets</div>
                </div>
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <div className="text-slate-500 text-[10px]">Target Type:</div>
                  <div className="text-slate-200">AWS S3 / Remote RGW</div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-emerald-400 flex items-center gap-1.5 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" /> Ready for sync
            </div>
          </div>

        </div>
      </div>

      {/* Selected Element Detail Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        {selectedElement === 'rgw-cluster' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" />
              Ceph RGW 3-Node Orchestrator Details & Zonegroup Topology
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              In Ceph, the Object Gateway daemon (RADOS Gateway or RGW) runs as a standalone HTTP service powered by the high-performance C++ Boost.Beast engine. A 3-node cluster ensures high availability and quorum during rolling upgrades.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase">Multisite Realm</span>
                <span className="text-cyan-400 font-bold text-sm">production-realm</span>
                <p className="text-slate-400 text-[11px] mt-1 font-sans">Encloses global namespaces across one or more data centers.</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase">Zonegroup Configuration</span>
                <span className="text-cyan-400 font-bold text-sm">default.zonegroup (master)</span>
                <p className="text-slate-400 text-[11px] mt-1 font-sans">Contains endpoints http://ceph-node01..03:8080.</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase">Ceph Orchestrator Command</span>
                <span className="text-emerald-400 font-bold text-xs">ceph orch apply rgw</span>
                <p className="text-slate-400 text-[11px] mt-1 font-sans">Automates container lifecycle via cephadm.</p>
              </div>
            </div>
          </div>
        )}

        {selectedElement === 'sync-engine' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />
              S3 Sync Engine Internals: Zero-Disk Multipart & Incremental Diff
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Traditional S3 copy utilities often download full multi-gigabyte tarballs or database dumps to a local scratch disk before re-uploading, exhausting local disk space or causing I/O bottlenecks. CephSync utilizes HTTP Range headers (<code className="text-amber-400 font-mono">bytes=start-end</code>) to stream individual 8MB chunks directly in memory via worker threads.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase">Incremental Matching</span>
                <span className="text-amber-400 font-bold">ETag + Timestamp + Size</span>
                <p className="text-slate-400 text-[11px] mt-1 font-sans">Eliminates redundant transfers by skipping unchanged keys.</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase">Orphan Multipart Protection</span>
                <span className="text-amber-400 font-bold">Automatic Abort on Failure</span>
                <p className="text-slate-400 text-[11px] mt-1 font-sans">Calls abort_multipart_upload to prevent hidden Ceph pool leaks.</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase">Network Resilience</span>
                <span className="text-amber-400 font-bold">Full Jitter Exponential Backoff</span>
                <p className="text-slate-400 text-[11px] mt-1 font-sans">Gracefully handles S3 503 SlowDown and connection resets.</p>
              </div>
            </div>
          </div>
        )}

        {selectedElement === 'backup-target' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-400" />
              Disaster Recovery Target Options
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              CephSync supports any destination endpoint that speaks the AWS S3 REST API. Because credentials and endpoint URLs are parameterized via environment variables, switching targets requires zero code modifications.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase">Target Scenario 1: AWS S3 Cloud</span>
                <p className="text-slate-300 text-xs mt-1 font-sans">
                  Leave <code className="text-indigo-400 font-mono">DEST_S3_ENDPOINT_URL</code> empty to route through AWS global edge endpoints. Perfect for offsite cloud cold archives.
                </p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase">Target Scenario 2: Secondary Ceph Cluster</span>
                <p className="text-slate-300 text-xs mt-1 font-sans">
                  Set <code className="text-indigo-400 font-mono">DEST_S3_ENDPOINT_URL</code> to the secondary datacenter VIP (e.g. <code className="text-indigo-400">http://ceph-dr.backup.internal:8080</code>).
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
