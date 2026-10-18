import React, { useState } from 'react';
import { Clock, ShieldCheck, Key, GitBranch, ArrowRight, Play, CheckCircle2, AlertTriangle, Terminal, FileCode } from 'lucide-react';

export const WorkflowInspector: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'flow' | 'secrets' | 'yaml'>('flow');

  const SECRETS_LIST = [
    { name: 'SOURCE_S3_ENDPOINT_URL', desc: 'Endpoint URL to primary Ceph RGW (e.g. http://192.168.10.11:8080)', required: true },
    { name: 'SOURCE_S3_ACCESS_KEY', desc: 'Ceph RGW Admin / Service user access key ID', required: true },
    { name: 'SOURCE_S3_SECRET_KEY', desc: 'Ceph RGW secret key (never printed in logs)', required: true },
    { name: 'DEST_S3_ENDPOINT_URL', desc: 'Target endpoint. Leave blank/empty when targeting native AWS S3', required: false },
    { name: 'DEST_S3_ACCESS_KEY', desc: 'Backup target access key ID', required: true },
    { name: 'DEST_S3_SECRET_KEY', desc: 'Backup target secret key', required: true },
    { name: 'DEFAULT_SOURCE_BUCKET', desc: 'Default source bucket when running on scheduled cron', required: false },
    { name: 'DEFAULT_DEST_BUCKET', desc: 'Default destination bucket for automated cron runs', required: false },
  ];

  return (
    <div className="space-y-6">
      {/* Workflow Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
              <h2 className="text-base font-bold text-slate-100 font-mono">
                .github/workflows/sync.yml
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Automated dual-trigger pipeline: runs nightly on scheduled cron or on-demand with manual inputs.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-cyan-300 bg-cyan-950/70 px-3 py-1.5 rounded-lg border border-cyan-800 font-mono">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              cron: '0 2 * * *' (02:00 AM UTC Daily)
            </span>
            <span className="flex items-center gap-1.5 text-xs text-purple-300 bg-purple-950/70 px-3 py-1.5 rounded-lg border border-purple-800 font-mono">
              <GitBranch className="w-3.5 h-3.5 text-purple-400" />
              workflow_dispatch
            </span>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex space-x-2 border-t border-slate-800 pt-4">
          {[
            { id: 'flow', label: 'Pipeline Steps Flow' },
            { id: 'secrets', label: 'Secrets Configuration Checklist' },
            { id: 'yaml', label: 'Raw Actions YAML' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 1: Pipeline Flow */}
      {activeTab === 'flow' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            {
              step: '1. Setup & Auth',
              title: 'Checkout & Python 3.11',
              desc: 'Checks out the repository, caches pip wheels, and verifies required secret presence in runner memory.',
              tag: 'actions/setup-python@v5',
            },
            {
              step: '2. Input Resolution',
              title: 'Parameter Resolution',
              desc: 'Evaluates trigger type (cron default vs workflow_dispatch inputs: source bucket, dest bucket, dry-run, workers).',
              tag: 'Dual Trigger Resolver',
            },
            {
              step: '3. Execution',
              title: 'Run sync_engine.py',
              desc: 'Executes Python engine with streamed JSONL logging piped to stdout and archived to logs/sync-output.jsonl.',
              tag: 'Zero-Disk Streaming',
            },
            {
              step: '4. Reporting & Artifacts',
              title: 'Summary & Log Upload',
              desc: 'Publishes Markdown metrics to $GITHUB_STEP_SUMMARY and saves JSONL log artifacts with 14-day retention.',
              tag: 'actions/upload-artifact@v4',
            },
          ].map((item, idx) => (
            <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg relative flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider block mb-1">
                  {item.step}
                </span>
                <h3 className="text-sm font-semibold text-slate-200 mb-2">{item.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">{item.desc}</p>
              </div>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-950 p-1.5 rounded border border-slate-800/80 truncate">
                {item.tag}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tab 2: Secrets Checklist */}
      {activeTab === 'secrets' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
          <div className="flex items-center space-x-2 mb-4">
            <Key className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-200">
              Required GitHub Repository Secrets
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Configure these under <strong>Settings &gt; Secrets and variables &gt; Actions</strong> in your GitHub repository. The engine never stores credentials on disk and masks them in all error reports.
          </p>

          <div className="space-y-2">
            {SECRETS_LIST.map((secret) => (
              <div
                key={secret.name}
                className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs font-mono"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-amber-400">{secret.name}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded border uppercase ${
                        secret.required
                          ? 'bg-red-950 text-red-400 border-red-800'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {secret.required ? 'Mandatory' : 'Optional'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-sans mt-0.5">{secret.desc}</p>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Encrypted via Libsodium</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Raw Actions YAML */}
      {activeTab === 'yaml' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="bg-slate-950 px-4 py-2 border-b border-slate-800 text-xs font-mono text-cyan-400">
            .github/workflows/sync.yml
          </div>
          <pre className="p-4 bg-slate-950 font-mono text-xs text-slate-300 overflow-x-auto max-h-[500px]">
{`name: Ceph RGW to S3 Scheduled Sync

on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:
    inputs:
      source_bucket:
        description: 'Source Bucket Name'
        required: true
        default: 'production-primary-assets'
      dest_bucket:
        description: 'Destination Bucket Name'
        required: true
        default: 'dr-backup-assets'
      sync_mode:
        type: choice
        options: [both, etag, timestamp]
        default: 'both'
      dry_run:
        type: boolean
        default: false
      delete_orphans:
        type: boolean
        default: false

jobs:
  s3-sync:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      - run: pip install -r sync_engine/requirements.txt
      - run: python3 sync_engine/sync_engine.py --source-bucket production-primary-assets --dest-bucket dr-backup-assets`}
          </pre>
        </div>
      )}
    </div>
  );
};
