/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Header } from './components/Header.tsx';
import { TopologyVisualizer } from './components/TopologyVisualizer.tsx';
import { CodeViewer } from './components/CodeViewer.tsx';
import { SyncEngineSimulator } from './components/SyncEngineSimulator.tsx';
import { CephSpecGenerator } from './components/CephSpecGenerator.tsx';
import { WorkflowInspector } from './components/WorkflowInspector.tsx';
import { RunbookGuide } from './components/RunbookGuide.tsx';
import { 
  Server, 
  RefreshCw, 
  FileCode, 
  ShieldCheck, 
  Activity, 
  Terminal, 
  GitBranch, 
  ExternalLink,
  Layers,
  ArrowRight
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('overview');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Navbar */}
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Hero Stat Banner */}
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 border-b border-slate-800/80 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-3xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-950/80 border border-cyan-800/80 text-cyan-300 text-xs font-mono">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                <span>Open Source Enterprise Infrastructure Suite</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                Ceph RGW 3-Node Orchestration & High-Speed S3 Sync Engine
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">
                Automated multi-node Ceph Object Gateway deployment using <code className="text-cyan-400 font-mono">ceph orch apply rgw</code> and a streaming Python synchronization utility with multipart chunking, full jitter backoff, and daily GitHub Actions cron.
              </p>
            </div>

            {/* Quick action buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setActiveTab('simulator')}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
              >
                <Activity className="w-4 h-4" />
                <span>Launch S3 Simulator</span>
              </button>
              <button
                onClick={() => setActiveTab('code')}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs transition-colors cursor-pointer"
              >
                <FileCode className="w-4 h-4 text-cyan-400" />
                <span>Inspect Repository Files</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <TopologyVisualizer />
            <RunbookGuide />
          </div>
        )}

        {activeTab === 'code' && (
          <CodeViewer />
        )}

        {activeTab === 'deployer' && (
          <CephSpecGenerator />
        )}

        {activeTab === 'simulator' && (
          <SyncEngineSimulator />
        )}

        {activeTab === 'cicd' && (
          <WorkflowInspector />
        )}
      </main>

      {/* Global Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 py-6 text-xs text-slate-400 font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-slate-300">CephSync Enterprise</span>
            <span>•</span>
            <span>Apache 2.0 Open Source</span>
            <span>•</span>
            <span className="text-cyan-400">Production Infrastructure Grade</span>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setActiveTab('overview')}
              className="hover:text-slate-200 transition-colors cursor-pointer"
            >
              Architecture
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className="hover:text-slate-200 transition-colors cursor-pointer"
            >
              Files
            </button>
            <button
              onClick={() => setActiveTab('simulator')}
              className="hover:text-slate-200 transition-colors cursor-pointer"
            >
              Simulator
            </button>
            <button
              onClick={() => setActiveTab('cicd')}
              className="hover:text-slate-200 transition-colors cursor-pointer"
            >
              GitHub Actions
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
