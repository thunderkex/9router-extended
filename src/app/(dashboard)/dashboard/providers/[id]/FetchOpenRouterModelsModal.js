"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Spinner } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const VENDOR_FILTERS = [
  { id: "all", label: "All" },
  { id: "free", label: "Free" },
  { id: "anthropic", label: "Anthropic", match: ["anthropic/", "claude"] },
  { id: "openai", label: "OpenAI", match: ["openai/", "gpt-", "o1", "o3", "chatgpt"] },
  { id: "deepseek", label: "DeepSeek", match: ["deepseek/", "deepseek-"] },
  { id: "google", label: "Google", match: ["google/", "gemini", "gemma"] },
  { id: "meta", label: "Meta / Llama", match: ["meta-llama/", "llama-", "meta/"] },
  { id: "mistral", label: "Mistral", match: ["mistralai/", "mistral-", "codestral"] },
  { id: "qwen", label: "Qwen", match: ["qwen/", "qwen-"] },
];

function formatPricing(pricing) {
  if (!pricing) return null;
  const prompt = parseFloat(pricing.prompt || "0");
  const completion = parseFloat(pricing.completion || "0");
  if (prompt === 0 && completion === 0) {
    return { isFree: true, label: "FREE" };
  }
  // OpenRouter pricing is per token, convert to per 1M tokens ($ / M)
  const promptPerM = (prompt * 1000000).toFixed(prompt * 1000000 >= 1 ? 2 : 4);
  const compPerM = (completion * 1000000).toFixed(completion * 1000000 >= 1 ? 2 : 4);
  return {
    isFree: false,
    label: `$${promptPerM} / $${compPerM} per M`,
  };
}

function formatContextLength(ctx) {
  if (!ctx || ctx <= 0) return null;
  if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(1)}M ctx`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}k ctx`;
  return `${ctx} ctx`;
}

export default function FetchOpenRouterModelsModal({
  isOpen,
  onClose,
  providerAlias = "openrouter",
  connectionId,
  customModels = [],
  modelAliases = {},
  onAddCustomModel,
  onDeleteCustomModel,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rawModels, setRawModels] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [actionInProgressId, setActionInProgressId] = useState(null);
  const [batchImporting, setBatchImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // Existing added model IDs
  const existingAddedIds = useMemo(() => {
    const set = new Set();
    customModels.forEach((m) => {
      if (m.providerAlias === providerAlias && m.id) {
        set.add(m.id);
      }
    });
    Object.values(modelAliases).forEach((fullModel) => {
      if (typeof fullModel === "string" && fullModel.startsWith(`${providerAlias}/`)) {
        set.add(fullModel.slice(providerAlias.length + 1));
      }
    });
    return set;
  }, [customModels, modelAliases, providerAlias]);

  // Fetch models catalog when modal opens
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setActiveCategory("all");
      setSelectedIds(new Set());
      setError("");
      setImportProgress("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const fetchUrl = connectionId
      ? `/api/providers/${connectionId}/models`
      : "https://openrouter.ai/api/v1/models";

    fetch(fetchUrl)
      .then(async (res) => {
        if (!res.ok) {
          // If connection endpoint failed, fallback to public openrouter catalog
          const fallbackRes = await fetch("https://openrouter.ai/api/v1/models");
          if (!fallbackRes.ok) throw new Error(`HTTP ${res.status}`);
          return fallbackRes.json();
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const list = json.data || json.models || [];
        setRawModels(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load OpenRouter models:", err);
        setError(err.message || "Failed to load models");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, connectionId]);

  // Counts per category
  const categoryCounts = useMemo(() => {
    const counts = { all: rawModels.length, free: 0 };
    VENDOR_FILTERS.forEach((vf) => {
      if (vf.id !== "all" && vf.id !== "free") counts[vf.id] = 0;
    });

    rawModels.forEach((m) => {
      const id = (m.id || "").toLowerCase();
      const isFree = m.pricing?.prompt === "0" && m.pricing?.completion === "0";
      if (isFree) counts.free += 1;

      VENDOR_FILTERS.forEach((vf) => {
        if (vf.match && vf.match.some((pattern) => id.includes(pattern))) {
          counts[vf.id] = (counts[vf.id] || 0) + 1;
        }
      });
    });

    return counts;
  }, [rawModels]);

  // Filtered models
  const filteredModels = useMemo(() => {
    let list = rawModels;

    // Filter by Category
    if (activeCategory === "free") {
      list = list.filter((m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0");
    } else if (activeCategory !== "all") {
      const activeFilter = VENDOR_FILTERS.find((vf) => vf.id === activeCategory);
      if (activeFilter?.match) {
        list = list.filter((m) => {
          const id = (m.id || "").toLowerCase();
          return activeFilter.match.some((pattern) => id.includes(pattern));
        });
      }
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      list = list.filter((m) => {
        const id = (m.id || "").toLowerCase();
        const name = (m.name || "").toLowerCase();
        const desc = (m.description || "").toLowerCase();
        return id.includes(query) || name.includes(query) || desc.includes(query);
      });
    }

    return list;
  }, [rawModels, activeCategory, searchQuery]);

  // Toggle select single
  const handleToggleSelect = (modelId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  // Toggle select all filtered
  const handleToggleSelectAll = () => {
    const unaddedFilteredIds = filteredModels
      .map((m) => m.id)
      .filter((id) => id && !existingAddedIds.has(id));

    const allSelected = unaddedFilteredIds.length > 0 && unaddedFilteredIds.every((id) => selectedIds.has(id));

    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        unaddedFilteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        unaddedFilteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // Single Add / Delete
  const handleToggleAdd = async (modelId) => {
    if (actionInProgressId || batchImporting) return;
    setActionInProgressId(modelId);
    try {
      if (existingAddedIds.has(modelId)) {
        await onDeleteCustomModel(modelId, "llm", providerAlias);
      } else {
        await onAddCustomModel(modelId, "llm", providerAlias);
      }
    } catch (err) {
      console.error("Action failed:", err);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Bulk Import Selected
  const handleImportSelected = async () => {
    if (selectedIds.size === 0 || batchImporting) return;
    setBatchImporting(true);
    const toImport = Array.from(selectedIds).filter((id) => !existingAddedIds.has(id));
    let count = 0;

    for (let i = 0; i < toImport.length; i++) {
      const id = toImport[i];
      setImportProgress(`Adding ${i + 1}/${toImport.length}: ${id}`);
      try {
        await onAddCustomModel(id, "llm", providerAlias);
        count++;
      } catch (err) {
        console.error(`Failed to add ${id}:`, err);
      }
    }

    setSelectedIds(new Set());
    setImportProgress("");
    setBatchImporting(false);
  };

  // 1-Click Import All Free Models
  const handleImportAllFree = async () => {
    if (batchImporting) return;
    const freeModels = rawModels.filter(
      (m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0" && !existingAddedIds.has(m.id)
    );

    if (freeModels.length === 0) {
      alert("All free models have already been added.");
      return;
    }

    setBatchImporting(true);
    for (let i = 0; i < freeModels.length; i++) {
      const id = freeModels[i].id;
      setImportProgress(`Adding Free Model ${i + 1}/${freeModels.length}: ${id}`);
      try {
        await onAddCustomModel(id, "llm", providerAlias);
      } catch (err) {
        console.error(`Failed to add ${id}:`, err);
      }
    }

    setImportProgress("");
    setBatchImporting(false);
  };

  const freeUnaddedCount = useMemo(() => {
    return rawModels.filter(
      (m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0" && !existingAddedIds.has(m.id)
    ).length;
  }, [rawModels, existingAddedIds]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Fetch OpenRouter Models"
      size="full"
    >
      <div className="flex flex-col gap-4 max-h-[80vh]">
        {/* Top bar description & quick actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-border">
          <div>
            <p className="text-xs text-text-muted">
              Explore and import from OpenRouter’s live catalog of {rawModels.length || "420+"} models.
            </p>
            <p className="text-[11px] text-text-muted">
              {existingAddedIds.size} models currently active in 9Router.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {freeUnaddedCount > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon="bolt"
                onClick={handleImportAllFree}
                disabled={batchImporting || loading}
                className="text-xs bg-green-500/10 hover:bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30"
              >
                {batchImporting ? "Importing..." : `Import All Free (${freeUnaddedCount})`}
              </Button>
            )}

            {selectedIds.size > 0 && (
              <Button
                size="sm"
                icon="add_circle"
                onClick={handleImportSelected}
                disabled={batchImporting || loading}
                className="text-xs"
              >
                {batchImporting ? "Importing..." : `Import Selected (${selectedIds.size})`}
              </Button>
            )}
          </div>
        </div>

        {/* Search and Category Filter Pills */}
        <div className="flex flex-col gap-2.5">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-lg">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by model ID, name, or keywords (e.g. claude-3.7, r1, gpt-4o, llama)..."
              className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text text-sm p-0.5"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
          </div>

          {/* Category Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {VENDOR_FILTERS.map((cat) => {
              const count = categoryCounts[cat.id] ?? 0;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    isActive
                      ? "bg-primary text-white shadow-sm"
                      : "bg-sidebar hover:bg-sidebar/80 text-text-muted hover:text-text border border-border/60"
                  }`}
                >
                  {cat.label}
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isActive ? "bg-white/20 text-white" : "bg-border/60 text-text-muted"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Batch progress message */}
        {importProgress && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-600 dark:text-blue-400">
            <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            <span>{importProgress}</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Content list */}
        <div className="flex-1 overflow-y-auto min-h-[250px] max-h-[48vh] border border-border rounded-lg divide-y divide-border/60 bg-surface">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-text-muted">
              <Spinner size="lg" />
              <p className="text-xs">{translate("Fetching OpenRouter models...")}</p>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted text-xs">
              <span className="material-symbols-outlined text-3xl mb-1 text-text-muted/60">search_off</span>
              <p>No models found matching your search.</p>
            </div>
          ) : (
            <>
              {/* Header row with select all */}
              <div className="flex items-center justify-between px-3 py-2 bg-sidebar/50 text-[11px] text-text-muted font-medium sticky top-0 z-10 backdrop-blur-sm border-b border-border">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="select-all-filtered"
                    checked={
                      filteredModels.some((m) => !existingAddedIds.has(m.id)) &&
                      filteredModels
                        .filter((m) => !existingAddedIds.has(m.id))
                        .every((m) => selectedIds.has(m.id))
                    }
                    onChange={handleToggleSelectAll}
                    className="rounded border-border text-primary focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="select-all-filtered" className="cursor-pointer select-none">
                    Showing {filteredModels.length} models
                  </label>
                </div>
                <span>Status & Pricing</span>
              </div>

              {filteredModels.map((model) => {
                const modelId = model.id;
                const isAdded = existingAddedIds.has(modelId);
                const isSelected = selectedIds.has(modelId);
                const pricing = formatPricing(model.pricing);
                const contextStr = formatContextLength(model.context_length);
                const isProcessing = actionInProgressId === modelId;

                return (
                  <div
                    key={modelId}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-sidebar/40 transition-colors ${
                      isAdded ? "bg-primary/[0.02]" : ""
                    }`}
                  >
                    {/* Left: Checkbox & Model info */}
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isAdded || batchImporting}
                        onChange={() => handleToggleSelect(modelId)}
                        className="mt-1 rounded border-border text-primary focus:ring-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-text truncate font-mono">
                            {modelId}
                          </span>
                          {contextStr && (
                            <span className="text-[10px] px-1.5 py-0.2 bg-sidebar text-text-muted border border-border/80 rounded font-medium">
                              {contextStr}
                            </span>
                          )}
                          {pricing?.isFree && (
                            <span className="text-[10px] px-1.5 py-0.2 bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30 rounded font-semibold">
                              FREE
                            </span>
                          )}
                        </div>

                        {model.name && model.name !== modelId && (
                          <p className="text-[11px] text-text-muted truncate mt-0.5">
                            {model.name}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Pricing & Add/Added Button */}
                    <div className="flex items-center gap-3 shrink-0">
                      {pricing && !pricing.isFree && (
                        <span className="text-[11px] text-text-muted hidden sm:inline-block font-mono">
                          {pricing.label}
                        </span>
                      )}

                      {isAdded ? (
                        <div className="flex items-center gap-1">
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-green-500/10 text-green-600 border border-green-500/20">
                            <span className="material-symbols-outlined text-[13px]">check</span>
                            Added
                          </span>
                          <button
                            onClick={() => handleToggleAdd(modelId)}
                            disabled={isProcessing || batchImporting}
                            className="p-1 hover:bg-red-500/10 text-text-muted hover:text-red-500 rounded transition-colors"
                            title="Remove from available models"
                          >
                            <span className="material-symbols-outlined text-sm">close</span>
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={isProcessing ? "progress_activity" : "add"}
                          onClick={() => handleToggleAdd(modelId)}
                          disabled={isProcessing || batchImporting}
                          className="text-xs h-7 px-2.5"
                        >
                          {isProcessing ? "Adding..." : "Add"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-xs text-text-muted">
            {filteredModels.length} of {rawModels.length} models
          </span>
          <Button onClick={onClose} size="sm" variant="ghost">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

FetchOpenRouterModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  providerAlias: PropTypes.string,
  connectionId: PropTypes.string,
  customModels: PropTypes.arrayOf(PropTypes.object),
  modelAliases: PropTypes.object,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
};
