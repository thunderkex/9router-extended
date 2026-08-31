"use client";

import { useState, useEffect, useRef } from "react";
import Card from "./Card";

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all"); // all, success, failed, pending
  const [searchTerm, setSearchTerm] = useState("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Auto-scroll to bottom when new logs arrive (if user is already at bottom)
  useEffect(() => {
    if (isAtBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs, isAtBottom]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAtBottom(atBottom);
  };

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const parsedLogs = logs.map((log, idx) => {
    const parts = log.split(" | ");
    if (parts.length < 7) return null;
    
    const status = parts[6];
    const skill = parts[7] || null;
    const isPending = status.includes("PENDING");
    const isFailed = status.includes("FAILED");
    const isSuccess = status.includes("OK");
    
    return {
      id: idx,
      timestamp: parts[0],
      model: parts[1],
      provider: parts[2],
      account: parts[3],
      inputTokens: parts[4],
      outputTokens: parts[5],
      status,
      skill,
      isPending,
      isFailed,
      isSuccess
    };
  }).filter(Boolean);

  const filteredLogs = parsedLogs.filter((log) => {
    // Status filter
    if (filterStatus !== "all") {
      if (filterStatus === "success" && !log.isSuccess) return false;
      if (filterStatus === "failed" && !log.isFailed) return false;
      if (filterStatus === "pending" && !log.isPending) return false;
    }
    
    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        log.model.toLowerCase().includes(search) ||
        log.provider.toLowerCase().includes(search) ||
        log.account.toLowerCase().includes(search) ||
        (log.skill && log.skill.toLowerCase().includes(search))
      );
    }
    
    return true;
  });

  const stats = {
    total: parsedLogs.length,
    success: parsedLogs.filter(l => l.isSuccess).length,
    failed: parsedLogs.filter(l => l.isFailed).length,
    pending: parsedLogs.filter(l => l.isPending).length,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header with Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">list_alt</span>
            Request Logs
          </h2>
          <div className="flex gap-1">
            <span className="px-2 py-1 rounded text-xs bg-surface-2 border border-border font-semibold text-text-muted">
              {stats.total} total
            </span>
            <span className="px-2 py-1 rounded text-xs bg-success/10 border border-success/30 font-semibold text-success">
              {stats.success} ✓
            </span>
            <span className="px-2 py-1 rounded text-xs bg-error/10 border border-error/30 font-semibold text-error">
              {stats.failed} ✗
            </span>
            {stats.pending > 0 && (
              <span className="px-2 py-1 rounded text-xs bg-primary/10 border border-primary/30 font-semibold text-primary animate-pulse">
                {stats.pending} ⋯
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-text-muted flex items-center gap-2 cursor-pointer hover:text-text-main transition-colors">
            <span className="hidden sm:inline">Auto Refresh (3s)</span>
            <span className="sm:hidden">Auto</span>
            <div
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                autoRefresh ? "bg-primary" : "bg-surface-2 border border-border"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${
                  autoRefresh ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </div>
          </label>
          <button
            onClick={() => fetchLogs(true)}
            disabled={loading}
            className="px-3 py-1.5 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search model, provider, or account..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 px-3 py-2 text-sm rounded-md bg-surface-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-sm rounded-md bg-surface-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All Status ({stats.total})</option>
          <option value="success">✓ Success ({stats.success})</option>
          <option value="failed">✗ Failed ({stats.failed})</option>
          <option value="pending">⋯ Pending ({stats.pending})</option>
        </select>
      </div>

      {/* Log Table */}
      <Card className="overflow-hidden bg-black/5 dark:bg-black/20">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="p-0 overflow-x-auto max-h-[600px] overflow-y-auto font-mono text-xs relative"
        >
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
              Loading logs...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-text-muted flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-3xl opacity-30">inbox</span>
              {searchTerm || filterStatus !== "all" ? "No logs match your filters." : "No logs recorded yet."}
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-surface-1 border-b border-border z-10 shadow-sm">
                <tr>
                  <th className="px-3 py-2 border-r border-border font-semibold text-text-muted">DateTime</th>
                  <th className="px-3 py-2 border-r border-border font-semibold text-text-muted">Model</th>
                  <th className="px-3 py-2 border-r border-border font-semibold text-text-muted">Provider</th>
                  <th className="px-3 py-2 border-r border-border font-semibold text-text-muted">Account</th>
                  <th className="px-3 py-2 border-r border-border font-semibold text-text-muted text-right">Input</th>
                  <th className="px-3 py-2 border-r border-border font-semibold text-text-muted text-right">Output</th>
                  <th className="px-3 py-2 font-semibold text-text-muted">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    className={`hover:bg-primary/5 transition-colors ${log.isPending ? "bg-primary/5" : ""}`}
                  >
                    <td className="px-3 py-2 border-r border-border text-text-muted">{log.timestamp}</td>
                    <td className="px-3 py-2 border-r border-border font-medium text-text-main">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{log.model}</span>
                        {log.skill && (
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary text-[10px] font-mono" title={`ECC Skill: ${log.skill}`}>
                            ⚡ {log.skill}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 border-r border-border">
                      <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-[10px] uppercase font-bold">
                        {log.provider}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-r border-border truncate max-w-[150px]" title={log.account}>
                      {log.account}
                    </td>
                    <td className="px-3 py-2 border-r border-border text-right text-primary font-semibold">
                      {log.inputTokens}
                    </td>
                    <td className="px-3 py-2 border-r border-border text-right text-success font-semibold">
                      {log.outputTokens}
                    </td>
                    <td
                      className={`px-3 py-2 font-bold ${
                        log.isSuccess
                          ? "text-success"
                          : log.isFailed
                          ? "text-error"
                          : "text-primary animate-pulse"
                      }`}
                    >
                      {log.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          
          {/* Scroll indicator */}
          {!isAtBottom && filteredLogs.length > 10 && (
            <button
              onClick={() => {
                if (scrollContainerRef.current) {
                  scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
                  setIsAtBottom(true);
                }
              }}
              className="absolute bottom-4 right-4 px-3 py-2 rounded-lg bg-primary text-white shadow-lg hover:bg-primary/90 flex items-center gap-1 text-sm font-medium animate-bounce"
            >
              <span className="material-symbols-outlined text-base">arrow_downward</span>
              Scroll to bottom
            </button>
          )}
        </div>
      </Card>
      
      <div className="text-[10px] text-text-muted italic flex items-center gap-1">
        <span className="material-symbols-outlined text-xs">info</span>
        Logs are loaded from the request history database. Showing {filteredLogs.length} of {stats.total} records.
      </div>
    </div>
  );
}
