import React, { useState } from 'react';
import { Copy, Check, FileCode, Folder, Search, Download, Terminal, ChevronRight, Hash } from 'lucide-react';
import { REPOSITORY_FILES, RepoFile } from '../data/repoFiles.ts';

export const CodeViewer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<RepoFile>(REPOSITORY_FILES[0]);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFiles = REPOSITORY_FILES.filter((file) =>
    file.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
    file.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getLanguageColor = (lang: string) => {
    switch (lang) {
      case 'bash': return 'text-emerald-400 bg-emerald-950/60 border-emerald-800';
      case 'python': return 'text-amber-400 bg-amber-950/60 border-amber-800';
      case 'yaml': return 'text-purple-400 bg-purple-950/60 border-purple-800';
      case 'dockerfile': return 'text-sky-400 bg-sky-950/60 border-sky-800';
      default: return 'text-cyan-400 bg-cyan-950/60 border-cyan-800';
    }
  };

  const lines = selectedFile.content.split('\n');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Sidebar: Repository File Tree */}
      <div className="lg:col-span-4 space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Folder className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-200">Repository Files</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded">
              {REPOSITORY_FILES.length} files
            </span>
          </div>

          {/* Search Box */}
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search file name or path..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* File List */}
          <div className="space-y-1.5 max-h-[620px] overflow-y-auto pr-1">
            {filteredFiles.map((file) => {
              const isSelected = selectedFile.path === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/90 border-cyan-500/60 text-white shadow-sm'
                      : 'bg-slate-950/50 border-slate-800/70 text-slate-300 hover:bg-slate-800/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2 min-w-0">
                      <FileCode className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`} />
                      <span className="text-xs font-mono font-medium truncate">{file.name}</span>
                    </div>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded uppercase border ${getLanguageColor(file.language)}`}>
                      {file.language}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono truncate pl-5">
                    {file.path}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Directory Structure Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300">
          <div className="flex items-center space-x-2 mb-2 text-slate-200 font-sans font-semibold">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>Target Git Layout</span>
          </div>
          <pre className="text-[11px] leading-relaxed text-slate-400 overflow-x-auto bg-slate-950 p-3 rounded-lg border border-slate-800/60">
{`├── .github/workflows/sync.yml
├── deploy/
│   ├── ceph-rgw-bootstrap.sh
│   ├── specs/rgw-service.yml
│   └── ansible/
│       ├── inventory.ini
│       └── site.yml
├── sync_engine/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── sync_engine.py
├── .env.example
├── LICENSE
└── README.md`}
          </pre>
        </div>
      </div>

      {/* Right Content Area: Code Viewer */}
      <div className="lg:col-span-8 space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          {/* File Header */}
          <div className="bg-slate-950 border-b border-slate-800 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono font-bold text-cyan-400">{selectedFile.path}</span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase border ${getLanguageColor(selectedFile.language)}`}>
                {selectedFile.language}
              </span>
              <span className="text-xs text-slate-400">({lines.length} lines)</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                <span>{copied ? 'Copied!' : 'Copy File'}</span>
              </button>
            </div>
          </div>

          {/* Description banner */}
          <div className="bg-slate-900/80 px-4 py-2 border-b border-slate-800/60 text-xs text-slate-300">
            {selectedFile.description}
          </div>

          {/* Code Body with Line Numbers */}
          <div className="p-4 bg-slate-950 overflow-x-auto max-h-[640px] overflow-y-auto font-mono text-xs leading-relaxed">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/60 group">
                    <td className="w-10 pr-4 text-right text-slate-600 select-none group-hover:text-slate-400 border-r border-slate-800/60 text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="pl-4 whitespace-pre text-slate-200">
                      {line || ' '}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
