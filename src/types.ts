export interface LogEntry {
  timestamp: string;
  type: 'system' | 'model_thought' | 'tool_call' | 'tool_response' | 'error';
  message: string;
  details?: any;
}

export interface TaskDescription {
  title: string;
  prompt: string;
}

export interface TaskParameters {
  provider: string;
  model: string;
  temperature: number;
  systemInstruction?: string;
  additionalParams?: Record<string, any>;
  retryStrategy?: {
    maxAttempts: number;
    intervalMs: number;
    backoff: 'exponential' | 'linear' | 'fixed';
  };
}

export interface TaskResults {
  summary?: string;
  outputFiles?: string[];
  error?: string;
  stdout?: string;
  stderr?: string;
  errorClassification?: 'OS_ERROR' | 'TOOL_ERROR' | 'MODEL_ERROR' | 'SYSTEM_RECLAIM_BREAKER' | 'UNKNOWN_ERROR';
}

export interface ResourceConsumption {
  durationMs: number;
  tokensUsed: number;
  cpuLoadAvg?: number;
  memoryUsedBytes?: number;
}

export interface Task {
  id: string;
  schemaVersion?: string;
  executorVersion?: string;
  description: TaskDescription;
  parameters: TaskParameters;
  executionStatus: 'pending' | 'running' | 'completed' | 'failed';
  results: TaskResults;
  logs: LogEntry[];
  resourceConsumption: ResourceConsumption;

  // Bridge executor extensions
  generation?: number;
  retryCount?: number;
  submitter?: string;
  executionState?: any;

  // Legacy compatibility getters / fields to prevent breakages
  title?: string;
  prompt?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  model?: string;
  temperature?: number;
  systemInstruction?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  startedExecutionTimestamp?: number;
  result?: string;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  availableModels: string[];
  parameters?: Record<string, any>;
  name?: string;
  desc?: string;
}

export interface AIConfig {
  activeProvider: string;
  activeModel: string;
  providers: Record<string, ProviderConfig>;
}

export interface AgentConfig {
  defaultModel: string;
  defaultTemperature: number;
  defaultSystemInstruction: string;
  dangerousCommandsBlocklist: string[];
}
