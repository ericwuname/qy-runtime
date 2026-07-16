import React, { useEffect, useState } from "react";
import { AIConfig, ProviderConfig } from "../types";
import { 
  Cpu, 
  Key, 
  Globe, 
  Settings, 
  Save, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle,
  Info,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Activity,
  Folder,
  FolderOpen,
  Eye,
  EyeOff
} from "lucide-react";

interface AIConfigManagerProps {
  onConfigChanged: () => void;
}

export default function AIConfigManager({ onConfigChanged }: AIConfigManagerProps) {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingProviderKey, setDeletingProviderKey] = useState<string | null>(null);

  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
  const [fetchError, setFetchError] = useState<Record<string, string | null>>({});
  const [fetchSuccess, setFetchSuccess] = useState<Record<string, boolean>>({});
  
  // Custom AI Provider registration form states
  const [newProviderKey, setNewProviderKey] = useState("");
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderBaseURL, setNewProviderBaseURL] = useState("");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");
  const [newProviderDesc, setNewProviderDesc] = useState("");
  const [addProviderError, setAddProviderError] = useState<string | null>(null);
  const [showAddProviderForm, setShowAddProviderForm] = useState(false);

  // Collapsible accordion & connection test states
  const [systemGroupExpanded, setSystemGroupExpanded] = useState(true);
  const [customGroupExpanded, setCustomGroupExpanded] = useState(true);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  
  // API Key visibility toggles
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [showNewProviderApiKey, setShowNewProviderApiKey] = useState(false);
  
  const toggleExpandProvider = (providerKey: string) => {
    setExpandedProviders(prev => {
      const isCurrentlyExpanded = !!prev[providerKey];
      if (isCurrentlyExpanded) {
        return {};
      } else {
        return { [providerKey]: true };
      }
    });
  };

  const [testingConnection, setTestingConnection] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; message: string } | null>>({});

  const [diagnosing, setDiagnosing] = useState<Record<string, boolean>>({});
  const [diagnoseResults, setDiagnoseResults] = useState<Record<string, any>>({});
  const [diagnoseError, setDiagnoseError] = useState<Record<string, string | null>>({});

  const handleRunDiagnose = async (providerKey: string) => {
    if (!config) return;
    const pConfig = config.providers[providerKey];
    if (!pConfig) return;

    let targetURL = pConfig.baseURL;
    if (!targetURL) {
      if (providerKey === "gemini") {
        targetURL = "https://generativelanguage.googleapis.com";
      } else if (providerKey === "anthropic") {
        targetURL = "https://api.anthropic.com";
      } else if (providerKey === "openai") {
        targetURL = "https://api.openai.com/v1";
      } else {
        setDiagnoseError(prev => ({ ...prev, [providerKey]: "需要提供 Base URL 才能进行网络诊断" }));
        return;
      }
    }

    setDiagnosing(prev => ({ ...prev, [providerKey]: true }));
    setDiagnoseError(prev => ({ ...prev, [providerKey]: null }));
    setDiagnoseResults(prev => ({ ...prev, [providerKey]: null }));

    try {
      const res = await fetch("/api/config/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseURL: targetURL, provider: providerKey })
      });
      if (!res.ok) {
        throw new Error(`服务器响应失败: HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.success && data.results) {
        setDiagnoseResults(prev => ({ ...prev, [providerKey]: data.results }));
      } else {
        throw new Error(data.error || "获取网络诊断结果失败");
      }
    } catch (err: any) {
      setDiagnoseError(prev => ({ ...prev, [providerKey]: err.message || String(err) }));
    } finally {
      setDiagnosing(prev => ({ ...prev, [providerKey]: false }));
    }
  };

  // Utility function to fetch available models from POST /api/config/fetch-models endpoint using live values
  const fetchAvailableModels = async (providerKey: string, pConfig: any): Promise<string[]> => {
    const res = await fetch("/api/config/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerKey,
        baseURL: pConfig.baseURL,
        apiKey: pConfig.apiKey
      })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `拉取失败: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.success && Array.isArray(data.models)) {
      return data.models;
    }
    throw new Error("返回的可用模型序列格式不正确");
  };

  const handleFetchModels = async (providerKey: string) => {
    if (!config) return;
    const pConfig = config.providers[providerKey];
    if (!pConfig) return;

    setFetchingModels(prev => ({ ...prev, [providerKey]: true }));
    setFetchError(prev => ({ ...prev, [providerKey]: null }));
    setFetchSuccess(prev => ({ ...prev, [providerKey]: false }));

    try {
      const models = await fetchAvailableModels(providerKey, pConfig);

      if (models.length > 0) {
        const updatedProvider = {
          ...config.providers[providerKey],
          availableModels: models,
          defaultModel: models.includes(config.providers[providerKey].defaultModel)
            ? config.providers[providerKey].defaultModel
            : models[0]
        };

        const isCurrentlyActive = config.activeProvider === providerKey;
        const updatedConfig = {
          ...config,
          activeModel: isCurrentlyActive
            ? (models.includes(config.activeModel) ? config.activeModel : models[0])
            : config.activeModel,
          providers: {
            ...config.providers,
            [providerKey]: updatedProvider
          }
        };

        // Persist the updated configuration to the server immediately
        const saveRes = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedConfig)
        });

        if (saveRes.ok) {
          const saveData = await saveRes.json();
          setConfig(saveData.config || updatedConfig);
          
          // Trigger parent callback to update system state/UI
          onConfigChanged();

          setFetchSuccess(prev => ({ ...prev, [providerKey]: true }));
          setTimeout(() => {
            setFetchSuccess(prev => ({ ...prev, [providerKey]: false }));
          }, 4000);
        } else {
          setFetchError(prev => ({ ...prev, [providerKey]: "拉取成功但自动保存至服务器失败" }));
        }
      } else {
        setFetchError(prev => ({ ...prev, [providerKey]: "返回的可用模型序列为空" }));
      }
    } catch (err: any) {
      setFetchError(prev => ({ ...prev, [providerKey]: err.message || `连接失败: ${err}` }));
    } finally {
      setFetchingModels(prev => ({ ...prev, [providerKey]: false }));
    }
  };

  const handleAddCustomProvider = async () => {
    const key = newProviderKey.trim().toLowerCase();
    const name = newProviderName.trim();
    const baseURL = newProviderBaseURL.trim();
    const apiKey = newProviderApiKey.trim();
    const desc = newProviderDesc.trim();

    if (!key || !name || !baseURL) {
      setAddProviderError("请完整填写 标识(Key)、名称(Name) 与 接口地址(Base URL)");
      return;
    }

    if (!/^[a-z0-9_]+$/.test(key)) {
      setAddProviderError("提供商标识仅限小写英文、数字和下划线 (e.g. deepseek)");
      return;
    }

    if (!config) return;

    if (config.providers[key]) {
      setAddProviderError(`标识为 '${key}' 的模型供应商已经存在`);
      return;
    }

    const newProviderObj = {
      apiKey: apiKey,
      baseURL: baseURL,
      defaultModel: "",
      availableModels: [],
      parameters: { maxTokens: 4096 },
      name: name,
      desc: desc || `自定义添加的 OpenAI 兼容提供商`
    };

    const updatedConfig = {
      ...config,
      providers: {
        ...config.providers,
        [key]: newProviderObj
      }
    };

    try {
      const saveRes = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig)
      });

      if (saveRes.ok) {
        const saveData = await saveRes.json();
        setConfig(saveData.config || updatedConfig);
        
        // Reset form
        setNewProviderKey("");
        setNewProviderName("");
        setNewProviderBaseURL("");
        setNewProviderApiKey("");
        setNewProviderDesc("");
        setAddProviderError(null);
        setShowAddProviderForm(false);
        
        onConfigChanged();
        triggerSuccessBanner();
      } else {
        const errData = await saveRes.json().catch(() => ({}));
        setAddProviderError(errData.error || "保存至服务器失败");
      }
    } catch (err: any) {
      setAddProviderError(`添加失败: ${err.message}`);
    }
  };

  const handleDeleteCustomProvider = async (providerKey: string) => {
    if (!config) return;
    
    const defaultKeys = ["gemini", "openai", "anthropic", "local_llm"];
    if (defaultKeys.includes(providerKey)) {
      setError("默认自带供应商不可删除");
      return;
    }

    if (deletingProviderKey !== providerKey) {
      setDeletingProviderKey(providerKey);
      // Auto cancel after 6 seconds if not clicked again
      setTimeout(() => {
        setDeletingProviderKey(prev => prev === providerKey ? null : prev);
      }, 6000);
      return;
    }

    // Reset state before delete
    setDeletingProviderKey(null);

    const { [providerKey]: deleted, ...remainingProviders } = config.providers;
    
    let nextActiveProvider = config.activeProvider;
    let nextActiveModel = config.activeModel;
    if (config.activeProvider === providerKey) {
      nextActiveProvider = "gemini";
      nextActiveModel = config.providers.gemini?.defaultModel || "gemini-3.5-flash";
    }

    const updatedConfig = {
      ...config,
      activeProvider: nextActiveProvider,
      activeModel: nextActiveModel,
      providers: remainingProviders
    };

    try {
      const saveRes = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig)
      });

      if (saveRes.ok) {
        const saveData = await saveRes.json();
        setConfig(saveData.config || updatedConfig);
        onConfigChanged();
        triggerSuccessBanner();
      } else {
        setError("删除供应商配置失败");
      }
    } catch (err: any) {
      setError(`删除失败: ${err.message}`);
    }
  };

  const handleTestConnection = async (providerKey: string) => {
    if (!config) return;
    const pConfig = config.providers[providerKey];
    if (!pConfig) return;

    setTestingConnection(prev => ({ ...prev, [providerKey]: true }));
    setTestResult(prev => ({ ...prev, [providerKey]: null }));

    try {
      const res = await fetch("/api/config/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerKey,
          baseURL: pConfig.baseURL,
          apiKey: pConfig.apiKey
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult(prev => ({ 
          ...prev, 
          [providerKey]: { success: true, message: data.message || "连接测试成功！" } 
        }));

        // Auto-save the config immediately on successful connection test to prevent losing keys on page reloads/refreshes
        try {
          const saveRes = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config)
          });
          if (saveRes.ok) {
            const saveData = await saveRes.json();
            setConfig(saveData.config || config);
            onConfigChanged();
          }
        } catch (saveErr) {
          console.error("Auto-saving config on successful connection test failed:", saveErr);
        }
      } else {
        setTestResult(prev => ({ 
          ...prev, 
          [providerKey]: { success: false, message: data.error || "连接测试失败，请检查配置。" } 
        }));
      }
    } catch (err: any) {
      setTestResult(prev => ({ 
        ...prev, 
        [providerKey]: { success: false, message: `连接请求异常: ${err.message}` } 
      }));
    } finally {
      setTestingConnection(prev => ({ ...prev, [providerKey]: false }));
    }
  };

  // Load configuration from API
  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setError(null);
      } else {
        setError("无法加载模型配置信息");
      }
    } catch (err) {
      setError("无法连接至后台配置服务");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (config && Object.keys(expandedProviders).length === 0) {
      setExpandedProviders({ [config.activeProvider]: true });
    }
  }, [config]);

  // Update active provider & model
  const handleSetActive = async (provider: string, model: string) => {
    if (!config) return;
    try {
      const res = await fetch("/api/config/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model })
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(prev => prev ? {
          ...prev,
          activeProvider: data.activeProvider || provider,
          activeModel: data.activeModel || model
        } : null);
        onConfigChanged();
        triggerSuccessBanner();
      } else {
        setError("设置活动模型失败");
      }
    } catch (err) {
      setError("请求更新活动模型失败");
    }
  };

  // Handle provider key or URL changes
  const handleProviderChange = (
    providerKey: string, 
    field: keyof ProviderConfig, 
    value: any
  ) => {
    if (!config) return;
    setConfig(prev => {
      if (!prev) return null;
      const provider = prev.providers[providerKey];
      return {
        ...prev,
        providers: {
          ...prev.providers,
          [providerKey]: {
            ...provider,
            [field]: value
          }
        }
      };
    });
  };

  // Handle nested parameter updates
  const handleParamChange = (
    providerKey: string,
    paramName: string,
    value: any
  ) => {
    if (!config) return;
    setConfig(prev => {
      if (!prev) return null;
      const provider = prev.providers[providerKey];
      const parameters = provider.parameters || {};
      return {
        ...prev,
        providers: {
          ...prev.providers,
          [providerKey]: {
            ...provider,
            parameters: {
              ...parameters,
              [paramName]: value
            }
          }
        }
      };
    });
  };

  // Save entire config to server
  const handleSaveAll = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        onConfigChanged();
        triggerSuccessBanner();
      } else {
        setError("保存配置文件失败");
      }
    } catch (err) {
      setError("无法连接至服务器保存更改");
    } finally {
      setSaving(false);
    }
  };

  const triggerSuccessBanner = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 font-mono text-xs gap-3">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
        <span>[SYSTEM INITIALIZING] 正在读取模型服务拓扑结构与 API 凭证...</span>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-rose-400 font-mono text-xs p-6 border border-rose-950/40 rounded bg-rose-950/10">
        <AlertTriangle className="w-6 h-6 mb-2 text-rose-500" />
        <span className="font-bold">{error || "配置加载失败"}</span>
        <button 
          onClick={fetchConfig}
          className="mt-4 px-3 py-1.5 bg-rose-900/30 hover:bg-rose-900/50 border border-rose-700/40 text-rose-300 rounded"
        >
          重新尝试
        </button>
      </div>
    );
  }

  const defaultProviders = [
    { key: "gemini", name: "Google Gemini", desc: "原生提供商，具有更长的上下文与极速的工具调用效率。" },
    { key: "openai", name: "OpenAI GPT", desc: "兼容标准 OpenAI 格式，支持自定义 Base URL 中转网关。" },
    { key: "anthropic", name: "Anthropic Claude", desc: "业界顶尖的代码与逻辑规划模型系列。" },
    { key: "agnes", name: "Agnes AI", desc: "中转中枢，完美适配 OpenAI 与 Claude 旗舰型模型系列。" },
    { key: "local_llm", name: "Local LLM (Ollama)", desc: "本地离线托管模型（通过本地 OpenAI 兼容端口服务）。" }
  ];

  const providersList = [...defaultProviders];
  if (config && config.providers) {
    Object.keys(config.providers).forEach(key => {
      if (!providersList.some(p => p.key === key)) {
        const customP = config.providers[key];
        providersList.push({
          key,
          name: customP.name || `自定义供应商: ${key}`,
          desc: customP.desc || `用户添加的自定义 OpenAI 兼容接口供应商 (${key})`
        });
      }
    });
  }

  const systemProvidersList = providersList.filter(p => ["gemini", "openai", "anthropic", "local_llm"].includes(p.key));
  const customProvidersList = providersList.filter(p => !["gemini", "openai", "anthropic", "local_llm"].includes(p.key));

  const renderProviderPanel = (p: typeof providersList[0]) => {
    const pConfig = config.providers[p.key];
    if (!pConfig) return null;
    const isActive = config.activeProvider === p.key;
    const isExpanded = !!expandedProviders[p.key];
    const isDefaultProvider = ["gemini", "openai", "anthropic", "local_llm"].includes(p.key);

    return (
      <div 
        key={p.key}
        className={`border rounded-lg transition-all flex flex-col ${
          isActive 
            ? "bg-[#0f172a]/80 border-blue-500/50 shadow-lg shadow-blue-500/5" 
            : "bg-[#111827]/60 border-[#1F2937] hover:border-slate-700 hover:bg-[#111827]/80"
        }`}
      >
        {/* Header (Click to Toggle Collapse) */}
        <div 
          onClick={() => toggleExpandProvider(p.key)}
          className="p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpandProvider(p.key);
              }}
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            
            <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-blue-500 animate-pulse' : 'bg-slate-700'}`} />
            
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold text-slate-200 truncate">
                  {pConfig.name || p.name}
                </span>
                {isActive && (
                  <span className="px-1.5 py-0.5 bg-blue-950/40 text-[8px] font-mono text-blue-400 border border-blue-900/50 rounded uppercase font-semibold">
                    Active Target
                  </span>
                )}
                {!isDefaultProvider && (
                  <span className="px-1.5 py-0.5 bg-amber-950/20 text-[8px] font-mono text-amber-400 border border-amber-900/30 rounded uppercase font-semibold">
                    Custom Provider
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5 font-sans truncate max-w-md">
                {pConfig.desc || p.desc}
              </p>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            {/* Models Count & Active Model Selection */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-slate-500">
                ({pConfig.availableModels.length} models)
              </span>
              <select
                value={isActive ? config.activeModel : pConfig.defaultModel}
                onChange={async (e) => {
                  const m = e.target.value;
                  if (isActive) {
                    await handleSetActive(p.key, m);
                  } else {
                    const updatedProvider = {
                      ...pConfig,
                      defaultModel: m
                    };
                    const updatedConfig = {
                      ...config,
                      providers: {
                        ...config.providers,
                        [p.key]: updatedProvider
                      }
                    };
                    try {
                      const saveRes = await fetch("/api/config", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(updatedConfig)
                      });
                      if (saveRes.ok) {
                        const saveData = await saveRes.json();
                        setConfig(saveData.config || updatedConfig);
                        onConfigChanged();
                        triggerSuccessBanner();
                      } else {
                        setError("同步默认模型选择失败");
                      }
                    } catch (err: any) {
                      setError(`无法连接至服务器保存更改: ${err.message || err}`);
                    }
                  }
                }}
                className="px-2 py-1 bg-[#0F172A] border border-[#1F2937] text-[10px] font-mono rounded text-slate-300 focus:outline-none focus:border-blue-500/50 max-w-[150px]"
              >
                {pConfig.availableModels.length === 0 ? (
                  <option value="">No models loaded</option>
                ) : (
                  pConfig.availableModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))
                )}
              </select>
            </div>

            <button
              type="button"
              onClick={() => handleSetActive(p.key, pConfig.defaultModel)}
              disabled={isActive}
              className={`px-2.5 py-1 text-[10px] font-mono rounded font-semibold border transition-all ${
                isActive
                  ? "bg-blue-600/10 border-blue-500/30 text-blue-400"
                  : "bg-[#0F172A] border-[#1F2937] text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              {isActive ? "ACTIVE" : "SWITCH"}
            </button>

            {!isDefaultProvider && (
              <button
                type="button"
                onClick={() => handleDeleteCustomProvider(p.key)}
                title={deletingProviderKey === p.key ? "点击第二次以确认彻底删除" : "删除该自定义模型供应商"}
                className={`px-2 py-1 text-[10px] font-mono font-semibold rounded border transition-all focus:outline-none flex items-center gap-1.5 ${
                  deletingProviderKey === p.key
                    ? "bg-rose-600 border-rose-500 text-white animate-pulse"
                    : "p-1 bg-rose-950/20 hover:bg-rose-900/40 border border-rose-900/40 text-rose-400 hover:text-rose-300"
                }`}
              >
                <Trash2 className={`w-3.5 h-3.5 shrink-0 ${deletingProviderKey === p.key ? "text-white" : "text-rose-500"}`} />
                {deletingProviderKey === p.key && <span>CONFIRM (确认)</span>}
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Body Content */}
        {isExpanded && (
          <div className="p-4 border-t border-[#1F2937]/50 space-y-4 bg-[#111827]/20">
            
            {/* Action Panel: Test Connection & Refresh Models */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/30 p-2.5 border border-[#1F2937]/30 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  Topology Actions:
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Test Connection Button */}
                <button
                  type="button"
                  onClick={() => handleTestConnection(p.key)}
                  disabled={testingConnection[p.key]}
                  className="px-2.5 py-1 bg-emerald-950/20 hover:bg-emerald-900/30 border border-emerald-900/40 text-[10px] text-emerald-400 hover:text-emerald-300 font-mono rounded focus:outline-none flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Activity className={`w-3.5 h-3.5 ${testingConnection[p.key] ? 'animate-pulse' : ''}`} />
                  <span>{testingConnection[p.key] ? "Testing..." : "Test API Connection (测试连通性)"}</span>
                </button>

                {/* Refresh Models Button */}
                <button
                  type="button"
                  onClick={() => handleFetchModels(p.key)}
                  disabled={fetchingModels[p.key]}
                  title="自动向指定的 Endpoint 接口拉取并同步可用模型序列列表"
                  className="px-2.5 py-1 bg-blue-950/20 hover:bg-blue-900/30 border border-blue-900/40 text-[10px] text-blue-400 hover:text-blue-300 font-mono rounded focus:outline-none flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${fetchingModels[p.key] ? 'animate-spin' : ''}`} />
                  <span>{fetchingModels[p.key] ? "Refreshing..." : "Fetch Available Models (拉取可用模型)"}</span>
                </button>
              </div>
            </div>

            {/* Test Results Feedbacks */}
            {testResult[p.key] && (
              <div className={`text-[10px] font-mono flex items-start gap-1.5 px-2.5 py-2 rounded border leading-relaxed ${
                testResult[p.key]?.success 
                  ? 'text-emerald-400 bg-emerald-950/15 border-emerald-900/30' 
                  : 'text-rose-400 bg-rose-950/15 border-rose-900/30'
              }`}>
                {testResult[p.key]?.success ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                )}
                <div>
                  <strong className="block mb-0.5 font-bold">
                    {testResult[p.key]?.success ? "Connection Successful (连通测试成功)" : "Connection Failed (连通测试失败)"}
                  </strong>
                  <span>{testResult[p.key]?.message}</span>
                </div>
              </div>
            )}

            {/* Fetch Status Feedback Alerts */}
            {fetchSuccess[p.key] && (
              <div className="text-[10px] text-emerald-400 font-mono flex items-center gap-1.5 bg-emerald-950/15 px-2.5 py-1.5 rounded border border-emerald-900/30">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                <span>成功自动拉取并重构了该服务商的可用模型序列！别忘了点击右上角的 "SAVE CONFIG" 固化保存。</span>
              </div>
            )}
            {fetchError[p.key] && (
              <div className="text-[10px] text-rose-400 font-mono flex items-center gap-1.5 bg-rose-950/15 px-2.5 py-1.5 rounded border border-rose-900/30 leading-relaxed">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>{fetchError[p.key]}</span>
              </div>
            )}

            {/* Network Diagnostics System */}
            {(fetchError[p.key] || (testResult[p.key] && !testResult[p.key]?.success) || diagnoseResults[p.key]) && (
              <div className="bg-[#1e293b]/30 border border-slate-800 rounded-lg p-3.5 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
                    <span className="text-xs font-mono font-bold text-slate-300">
                      网络联通性排查助手 (Network Troubleshooter)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRunDiagnose(p.key)}
                    disabled={diagnosing[p.key]}
                    className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 text-[10px] font-mono border border-amber-500/30 rounded focus:outline-none flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {diagnosing[p.key] ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>正在排查中...</span>
                      </>
                    ) : (
                      <span>一键诊断网络状态 (Run Diagnostics)</span>
                    )}
                  </button>
                </div>

                {diagnoseError[p.key] && (
                  <div className="text-[10px] text-rose-400 font-mono bg-rose-950/15 px-2.5 py-1.5 rounded border border-rose-900/30">
                    诊断执行失败: {diagnoseError[p.key]}
                  </div>
                )}

                {diagnoseResults[p.key] && (
                  <div className="space-y-3">
                    {/* Step-by-Step checklist */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      {/* URL Check */}
                      <div className={`p-2 rounded border font-mono text-[10px] space-y-1 ${
                        diagnoseResults[p.key].urlValid 
                          ? 'bg-emerald-950/10 border-emerald-900/20 text-emerald-400' 
                          : 'bg-rose-950/10 border-rose-900/20 text-rose-400'
                      }`}>
                        <div className="font-bold flex items-center gap-1">
                          {diagnoseResults[p.key].urlValid ? '✓' : '✗'} 1. URL 格式
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">
                          {diagnoseResults[p.key].protocol}//{diagnoseResults[p.key].host}
                        </div>
                      </div>

                      {/* Outbound check */}
                      <div className={`p-2 rounded border font-mono text-[10px] space-y-1 ${
                        diagnoseResults[p.key].outboundOk 
                          ? 'bg-emerald-950/10 border-emerald-900/20 text-emerald-400' 
                          : 'bg-rose-950/10 border-rose-900/20 text-rose-400'
                      }`}>
                        <div className="font-bold flex items-center gap-1">
                          {diagnoseResults[p.key].outboundOk ? '✓' : '✗'} 2. 容器外网
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">
                          {diagnoseResults[p.key].outboundOk ? '出口通畅' : diagnoseResults[p.key].outboundError || '出境失败'}
                        </div>
                      </div>

                      {/* DNS Check */}
                      <div className={`p-2 rounded border font-mono text-[10px] space-y-1 ${
                        diagnoseResults[p.key].dnsOk 
                          ? 'bg-emerald-950/10 border-emerald-900/20 text-emerald-400' 
                          : 'bg-rose-950/10 border-rose-900/20 text-rose-400'
                      }`}>
                        <div className="font-bold flex items-center gap-1">
                          {diagnoseResults[p.key].dnsOk ? '✓' : '✗'} 3. 域名解析
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">
                          {diagnoseResults[p.key].dnsOk ? diagnoseResults[p.key].dnsIp : diagnoseResults[p.key].dnsError || '解析失败'}
                        </div>
                      </div>

                      {/* TCP/HTTP Check */}
                      <div className={`p-2 rounded border font-mono text-[10px] space-y-1 ${
                        diagnoseResults[p.key].targetOk 
                          ? 'bg-emerald-950/10 border-emerald-900/20 text-emerald-400' 
                          : 'bg-rose-950/10 border-rose-900/20 text-rose-400'
                      }`}>
                        <div className="font-bold flex items-center gap-1">
                          {diagnoseResults[p.key].targetOk ? '✓' : '✗'} 4. 握手连接
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">
                          {diagnoseResults[p.key].targetOk ? `HTTP ${diagnoseResults[p.key].targetStatus}` : '建立握手失败'}
                        </div>
                      </div>
                    </div>

                    {/* Diagnostics Bullet Points */}
                    <div className="p-3 bg-[#0F172A] border border-slate-800 rounded-lg space-y-2">
                      <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                        系统诊断结论与建议 (Diagnostics & Guidelines):
                      </div>
                      <ul className="space-y-1.5 font-sans text-[10.5px] leading-relaxed text-slate-300">
                        {diagnoseResults[p.key].diagnostics?.map((diag: string, i: number) => {
                          const isSuccess = diag.includes('正常') || diag.includes('成功');
                          return (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className={`shrink-0 text-xs mt-0.5 ${isSuccess ? 'text-emerald-500' : 'text-amber-500'}`}>
                                {isSuccess ? '●' : '▲'}
                              </span>
                              <span className="whitespace-pre-line">{diag}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Form Input fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Name (Editable for Custom Providers) */}
              {!isDefaultProvider && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-slate-500" /> Provider Display Name (名称修改)
                  </label>
                  <input
                    type="text"
                    placeholder="例如: DeepSeek AI"
                    value={pConfig.name || ""}
                    onChange={(e) => handleProviderChange(p.key, "name", e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              )}

              {/* Description (Editable for Custom Providers) */}
              {!isDefaultProvider && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-slate-500" /> Provider Description (描述修改)
                  </label>
                  <input
                    type="text"
                    placeholder="自定义 OpenAI 兼容接口供应商"
                    value={pConfig.desc || ""}
                    onChange={(e) => handleProviderChange(p.key, "desc", e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              )}

              {/* API Key */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-slate-500" /> API Access Token / Key
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showApiKey[p.key] ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={p.key === "local_llm" ? "无需凭证 - 免密运行" : "输入对应平台的 API Key 凭证保护锁"}
                    disabled={p.key === "local_llm"}
                    value={pConfig.apiKey}
                    onChange={(e) => handleProviderChange(p.key, "apiKey", e.target.value)}
                    className="w-full pl-2.5 pr-8 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
                  />
                  {p.key !== "local_llm" && (
                    <button
                      type="button"
                      onClick={() => setShowApiKey(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                      className="absolute right-2 text-slate-500 hover:text-slate-300 focus:outline-none"
                    >
                      {showApiKey[p.key] ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Base URL */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-slate-500" /> API Entry-Point URL
                </label>
                <input
                  type="text"
                  placeholder="例如: https://api.openai.com/v1"
                  disabled={p.key === "gemini"}
                  value={pConfig.baseURL}
                  onChange={(e) => handleProviderChange(p.key, "baseURL", e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 disabled:opacity-40"
                />
              </div>
            </div>

            {/* Model Params */}
            <div className="pt-2.5 border-t border-[#1F2937]/30 flex flex-wrap gap-4 items-center text-[10px] font-mono text-slate-500">
              <div className="flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-slate-600" />
                <span>PARAMETERS:</span>
              </div>
              {p.key === "gemini" && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span>Max Output Tokens:</span>
                    <input
                      type="number"
                      value={pConfig.parameters?.maxOutputTokens || 4096}
                      onChange={(e) => handleParamChange(p.key, "maxOutputTokens", Number(e.target.value))}
                      className="w-16 bg-[#0F172A] border border-[#1F2937] px-1 py-0.5 rounded text-center text-slate-300 text-[10px] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1 relative group cursor-help bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    <Info className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] text-slate-400 group-hover:text-blue-300 transition-colors">
                      建议默认 (4096)
                    </span>
                  </div>
                </div>
              )}
              {p.key !== "gemini" && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span>Max Output Tokens:</span>
                    <input
                      type="number"
                      value={pConfig.parameters?.maxTokens || 4096}
                      onChange={(e) => handleParamChange(p.key, "maxTokens", Number(e.target.value))}
                      className="w-16 bg-[#0F172A] border border-[#1F2937] px-1 py-0.5 rounded text-center text-slate-300 text-[10px] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1 relative group cursor-help bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    <Info className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] text-slate-400 group-hover:text-blue-300 transition-colors">
                      建议默认 (4096)
                    </span>
                  </div>

                  {p.key === "openai" && (
                    <>
                      <div className="flex items-center gap-1">
                        <span>Presence Penalty:</span>
                        <input
                          type="number"
                          step="0.1"
                          value={pConfig.parameters?.presencePenalty || 0.0}
                          onChange={(e) => handleParamChange(p.key, "presencePenalty", parseFloat(e.target.value))}
                          className="w-12 bg-[#0F172A] border border-[#1F2937] px-1 py-0.5 rounded text-center text-slate-300 text-[10px] focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span>Frequency Penalty:</span>
                        <input
                          type="number"
                          step="0.1"
                          value={pConfig.parameters?.frequencyPenalty || 0.0}
                          onChange={(e) => handleParamChange(p.key, "frequencyPenalty", parseFloat(e.target.value))}
                          className="w-12 bg-[#0F172A] border border-[#1F2937] px-1 py-0.5 rounded text-center text-slate-300 text-[10px] focus:outline-none"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0F172A] border border-[#1F2937] rounded font-sans">
      {/* Header Panel */}
      <div className="p-4 border-b border-[#1F2937] bg-[#111827] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
            AI Provider Topology Core (智能模型调度矩阵)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" /> 已同步至本地 ai_config.json
            </span>
          )}
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-mono font-semibold rounded flex items-center gap-1.5 transition-colors border border-blue-500/30"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "正在写入..." : "SAVE CONFIG (保存配置)"}
          </button>
        </div>
      </div>

      {/* Main Form Fields */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* active status indicator banner */}
        <div className="p-3 border border-blue-500/20 rounded bg-blue-950/10 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-blue-400 font-mono font-bold block uppercase tracking-widest">Active Dispatcher Target (当前决策引擎目标)</span>
            <span className="text-xs font-mono font-bold text-slate-200">
              Provider: <span className="text-blue-300">{config.activeProvider.toUpperCase()}</span> • Model: <span className="text-blue-300">{config.activeModel}</span>
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono text-right max-w-xs">
            系统支持 CLI 参数覆盖。在运行中传入 <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">--provider=xxx</code> 或 <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">--model=yyy</code> 时可动态指定。
          </div>
        </div>

        {/* List of Provider Config Panels */}
        <div className="space-y-4">
          {/* 本机自带供应商 (Built-in Providers) Group */}
          <div className="border border-slate-800 rounded-lg bg-slate-900/20 overflow-hidden">
            <div 
              onClick={() => setSystemGroupExpanded(!systemGroupExpanded)}
              className="flex items-center justify-between p-3.5 bg-[#111827]/80 border-b border-slate-800/80 cursor-pointer select-none hover:bg-slate-900/70 transition-colors"
            >
              <div className="flex items-center gap-2">
                {systemGroupExpanded ? (
                  <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span className="text-xs font-mono font-bold text-slate-300">
                  本机自带供应商 (System Built-in Providers)
                </span>
                <span className="text-[10px] font-mono text-slate-400 bg-[#0F172A] px-2 py-0.5 rounded-full border border-slate-800">
                  {systemProvidersList.length}
                </span>
              </div>
              {systemGroupExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
            
            {systemGroupExpanded && (
              <div className="p-4 space-y-4 bg-slate-950/20">
                {systemProvidersList.map(p => renderProviderPanel(p))}
              </div>
            )}
          </div>

          {/* 客户自定义供应商 (Custom Providers) Group */}
          <div className="border border-slate-800 rounded-lg bg-slate-900/20 overflow-hidden">
            <div 
              onClick={() => setCustomGroupExpanded(!customGroupExpanded)}
              className="flex items-center justify-between p-3.5 bg-[#111827]/80 border-b border-slate-800/80 cursor-pointer select-none hover:bg-slate-900/70 transition-colors"
            >
              <div className="flex items-center gap-2">
                {customGroupExpanded ? (
                  <FolderOpen className="w-4 h-4 text-blue-500 shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                )}
                <span className="text-xs font-mono font-bold text-slate-300">
                  客户自定义供应商 (Custom API Providers)
                </span>
                <span className="text-[10px] font-mono text-slate-400 bg-[#0F172A] px-2 py-0.5 rounded-full border border-slate-800">
                  {customProvidersList.length}
                </span>
              </div>
              {customGroupExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
            
            {customGroupExpanded && (
              <div className="p-4 space-y-4 bg-slate-950/20">
                {customProvidersList.length === 0 ? (
                  <div className="text-xs text-slate-500 font-mono py-8 text-center bg-[#111827]/30 rounded border border-slate-800/40 border-dashed">
                    暂无自定义供应商。您可以通过下方表单注册添加全新的 OpenAI 兼容网关服务商。
                  </div>
                ) : (
                  customProvidersList.map(p => renderProviderPanel(p))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Add Custom Provider Button/Form Block */}
        <div className="border border-dashed border-[#1F2937] hover:border-slate-700 bg-[#111827]/10 p-4 rounded transition-all">
          {!showAddProviderForm ? (
            <button
              type="button"
              onClick={() => setShowAddProviderForm(true)}
              className="w-full py-2 flex items-center justify-center gap-2 text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors focus:outline-none"
            >
              <Plus className="w-4 h-4" />
              <span>添加自定义模型供应商 (OpenAI 兼容端点) / Add Custom AI Provider</span>
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#1F2937]/50 pb-2">
                <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-blue-400" />
                  <span>添加自定义 OpenAI 兼容供应商 / Add Custom AI Provider</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddProviderForm(false);
                    setAddProviderError(null);
                  }}
                  className="text-[10px] text-slate-500 hover:text-slate-300 font-mono focus:outline-none"
                >
                  取消 (Cancel)
                </button>
              </div>

              {addProviderError && (
                <div className="text-[10px] text-rose-400 font-mono bg-rose-950/15 p-2 rounded border border-rose-900/30">
                  {addProviderError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Key (ID) */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    提供商标识 (ID Key) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: deepseek (限小写英文/数字)"
                    value={newProviderKey}
                    onChange={(e) => setNewProviderKey(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                {/* Display Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    显示名称 (Name) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: DeepSeek AI"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                {/* Base URL */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    接口端点 (Base URL) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如: https://api.deepseek.com/v1"
                    value={newProviderBaseURL}
                    onChange={(e) => setNewProviderBaseURL(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                {/* API Key */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    API Key / Token
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showNewProviderApiKey ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="例如: sk-..."
                      value={newProviderApiKey}
                      onChange={(e) => setNewProviderApiKey(e.target.value)}
                      className="w-full pl-2.5 pr-8 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-700 focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewProviderApiKey(prev => !prev)}
                      className="absolute right-2 text-slate-500 hover:text-slate-300 focus:outline-none"
                    >
                      {showNewProviderApiKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    简介描述 (Description)
                  </label>
                  <input
                    type="text"
                    placeholder="例如: 极高性价比的 OpenAI 兼容推理服务提供商。"
                    value={newProviderDesc}
                    onChange={(e) => setNewProviderDesc(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#0F172A] border border-[#1F2937] text-xs font-mono rounded text-slate-300 placeholder-slate-700 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddProviderForm(false);
                    setAddProviderError(null);
                  }}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-[#1F2937] text-slate-400 text-xs font-mono rounded transition-colors focus:outline-none"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleAddCustomProvider}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-semibold rounded transition-colors flex items-center gap-1 border border-blue-500/20 focus:outline-none"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加并保存 (Register)</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Security Warning Panel */}
        <div className="p-3 border border-amber-500/20 rounded bg-amber-950/10 flex gap-2.5 items-start">
          <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-[10px] leading-relaxed font-mono">
            <span className="font-bold text-amber-400 block uppercase">Sensitive Credentials Warning (安全机密告示)</span>
            <p className="text-slate-400">
              API Keys 默认存储于容器运行沙箱中的 <code className="bg-slate-900 px-1 py-0.2 rounded text-slate-300">ai_config.json</code>，且服务器启动时会自动检测注入环境变量以保全凭据（如 <code className="bg-slate-900 px-1 py-0.2 rounded text-slate-300">GEMINI_API_KEY</code>, <code className="bg-slate-900 px-1 py-0.2 rounded text-slate-300">OPENAI_API_KEY</code>, <code className="bg-slate-900 px-1 py-0.2 rounded text-slate-300">ANTHROPIC_API_KEY</code> 等）。
              请不要直接在代码中明文硬编码密钥。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
