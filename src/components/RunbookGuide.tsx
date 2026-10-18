import React from 'react';
import { BookOpen, Terminal, ShieldAlert, Cpu, Layers, HardDrive, CheckCircle2 } from 'lucide-react';

export const RunbookGuide: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Runbook Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center space-x-2 mb-2">
          <BookOpen className="w-5 h-5 text-cyan-400" />
          <h2 className="text-base font-bold text-slate-100">
            Production Engineering Runbook: Ceph RGW & Enterprise S3 Operations
          </h2>
        </div>
        <p className="text-xs text-slate-400">
          Field-tested architectural patterns, performance tuning configurations, and disaster recovery procedures compiled by Senior Infrastructure Engineers.
        </p>
      </div>

      {/* Grid of Best Practice Modules */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Module 1: Ceph Beast Frontend Tuning */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
          <div className="flex items-center space-x-2 text-cyan-400">
            <Cpu className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              1. Boost.Beast HTTP Server Optimization
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Ceph RGW uses the Boost.Beast asynchronous HTTP engine. For production nodes handling thousands of concurrent PUT/GET streams, update Ceph configuration to scale connection limits:
          </p>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] font-mono text-cyan-300">
            <div className="text-slate-500"># In /etc/ceph/ceph.conf or ceph config set global</div>
            <div>ceph config set client.rgw rgw_frontends "beast endpoint=0.0.0.0:8080 max_connection=8192 max_header_size=65536"</div>
            <div>ceph config set client.rgw rgw_thread_pool_size 512</div>
          </div>
          <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
            <li>Prevents 503 HTTP errors during massive backup ingest bursts.</li>
            <li>Maintains low P99 latencies under high parallel worker load.</li>
          </ul>
        </div>

        {/* Module 2: ETag Normalization */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
          <div className="flex items-center space-x-2 text-amber-400">
            <Layers className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              2. S3 & Ceph ETag Calculation Nuances
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Single-part S3 objects have ETags matching the raw MD5 checksum. However, multipart objects have ETags calculated as <code className="text-amber-400 font-mono">MD5(MD5_part1 + MD5_part2...)-N</code>, where <code className="text-amber-400">N</code> is part count.
          </p>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300">
            <div className="text-slate-500"># CephSync normalizes multipart ETags:</div>
            <div className="text-amber-400">src_clean = src.etag.replace('"', '').split("-")[0]</div>
            <div className="text-slate-400"># If sizes match and target is newer, skip redundant transfers.</div>
          </div>
          <p className="text-xs text-slate-400">
            Using <code className="text-cyan-400 font-mono">--sync-mode both</code> guarantees accuracy by pairing ETag hashes with modification timestamps.
          </p>
        </div>

        {/* Module 3: Orphan Multipart Parts Cleanup */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
          <div className="flex items-center space-x-2 text-red-400">
            <ShieldAlert className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              3. Preventing Storage Leaks (Orphan Parts)
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            When a client begins a multipart upload but crashes before completing it, Ceph RGW stores those orphaned parts indefinitely in the <code className="text-slate-200 font-mono">.rgw.buckets.non-ec</code> pool.
          </p>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] font-mono text-emerald-400">
            <div className="text-slate-500"># Inspect active uncompleted multipart uploads:</div>
            <div>radosgw-admin multipart list --bucket=production-primary-assets</div>
            <div className="text-slate-500 mt-2"># Purge multipart uploads older than 7 days:</div>
            <div>radosgw-admin gc process --include-all</div>
          </div>
          <p className="text-xs text-slate-400">
            CephSync includes strict exception handling that automatically executes <code className="text-cyan-400 font-mono">abort_multipart_upload</code> upon any fatal exception.
          </p>
        </div>

        {/* Module 4: Dynamic Bucket Index Sharding */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
          <div className="flex items-center space-x-2 text-emerald-400">
            <HardDrive className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              4. Bucket Index Sharding at Scale
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Buckets containing more than 100,000 objects can bottleneck on a single RADOS OSD object index lock. Ceph supports dynamic online resharding:
          </p>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] font-mono text-cyan-300">
            <div className="text-slate-500"># Check bucket limit status:</div>
            <div>radosgw-admin bucket limit check</div>
            <div className="text-slate-500 mt-2"># Manually reshard index across 64 shards:</div>
            <div>radosgw-admin bucket reshard --bucket=production-primary-assets --num-shards=64</div>
          </div>
          <p className="text-xs text-slate-400">
            Ensures listing and synchronization operations run with zero latency degradation.
          </p>
        </div>

      </div>
    </div>
  );
};
