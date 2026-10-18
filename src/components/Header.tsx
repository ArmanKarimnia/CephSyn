import React, { useState } from 'react';
import { Download, Terminal, Check, Copy, ExternalLink, ShieldCheck, Server, RefreshCw } from 'lucide-react';
import JSZip from 'jszip';
import { REPOSITORY_FILES } from '../data/repoFiles.ts';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  const [downloading, setDownloading] = useState(false);
  const [copiedClone, setCopiedClone] = useState(false);

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const zip = new JSZip();
      
      // Add all project files into the zip archive
      REPOSITORY_FILES.forEach((file) => {
        zip.file(file.path, file.content);
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'cephsync-enterprise.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to create zip:', e);
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyClone = () => {
    navigator.clipboard.writeText('git clone https://github.com/ceph-ops/cephsync-enterprise.git');
    setCopiedClone(true);
    setTimeout(() => setCopiedClone(false), 2000);
  };

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Project Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-cyan-400/30">
              <Server className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                  CephSync
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/80">
                  Enterprise v2.4
                </span>
                <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/50">
                  <ShieldCheck className="w-3 h-3" /> Production Ready
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                3-Node Ceph RGW Automation & High-Throughput S3 Synchronization Engine
              </p>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center space-x-3">
            <button
              onClick={handleCopyClone}
              className="hidden lg:flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700/80 text-xs font-mono text-slate-300 border border-slate-700/80 transition-colors"
              title="Copy git clone command"
            >
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>git clone ...</span>
              {copiedClone ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            </button>

            <button
              onClick={handleDownloadZip}
              disabled={downloading}
              className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-md shadow-cyan-600/30 transition-all cursor-pointer disabled:opacity-50"
            >
              {downloading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{downloading ? 'Packing...' : 'Download Repo (.zip)'}</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto py-2 no-scrollbar border-t border-slate-800/60">
          {[
            { id: 'overview', label: 'Architecture & Runbook' },
            { id: 'code', label: 'Repository Explorer' },
            { id: 'deployer', label: 'Cephadm Deployer' },
            { id: 'simulator', label: 'S3 Sync Simulator' },
            { id: 'cicd', label: 'GitHub Actions CI/CD' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
};
