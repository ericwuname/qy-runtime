import { GoogleGenAI } from "@google/genai";
import { toolsList } from "./tools";

export function getBackupProvider(currentProvider: string, currentConfig: any): { name: string; model: string } | null {
  if (!currentConfig || !currentConfig.providers) return null;
  
  // Try with non-empty API keys first
  let candidates = Object.entries(currentConfig.providers)
    .filter(([name, p]: [string, any]) => {
      if (name.toLowerCase() === currentProvider.toLowerCase()) return false;
      const apiKey = p?.apiKey;
      return apiKey && typeof apiKey === "string" && apiKey.trim() !== "" && apiKey !== "not-needed" && apiKey !== "******";
    })
    .map(([name, p]: [string, any]) => ({
      name,
      model: p.defaultModel || (p.availableModels && p.availableModels[0]) || ""
    }))
    .filter(c => c.model !== "");

  if (candidates.length === 0) {
    // Fallback: try any provider with a default model that is not the current one
    candidates = Object.entries(currentConfig.providers)
      .filter(([name, p]: [string, any]) => name.toLowerCase() !== currentProvider.toLowerCase())
      .map(([name, p]: [string, any]) => ({
        name,
        model: p.defaultModel || (p.availableModels && p.availableModels[0]) || ""
      }))
      .filter(c => c.model !== "");
  }

  return candidates.length > 0 ? candidates[0] : null;
}

// Multi-Provider execution dispatcher with tool use mappings
export async function callAIProvider(
  providerName: string,
  modelName: string,
  history: any[],
  temperature: number,
  systemInstruction: string,
  config: any
): Promise<{ text: string; functionCalls?: any[]; tokensUsed: number }> {
  const provider = config.providers[providerName];
  if (!provider) {
    throw new Error(`未知或未配置的模型提供商: ${providerName}`);
  }
  
  const apiKey = provider.apiKey || "";
  const baseURL = provider.baseURL || "";
  
  switch (providerName) {
    case "gemini": {
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "******") {
        throw new Error("未配置有效的 Gemini API Key。请在配置管理面板中填写。");
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          }
        }
      });
      const response = await ai.models.generateContent({
        model: modelName,
        contents: history,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: toolsList }],
          temperature,
          maxOutputTokens: provider.parameters?.maxOutputTokens || 4096
        }
      });
      const tokensUsed = response.usageMetadata?.totalTokenCount || 0;
      return {
        text: response.text || "",
        functionCalls: response.functionCalls?.map((c: any) => ({
          name: c.name,
          args: c.args,
          id: c.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        })),
        tokensUsed
      };
    }
    
    case "openai":
    case "agnes":
    case "local_llm":
    default: {
      if (providerName !== "openai" && providerName !== "agnes" && providerName !== "agnesai" && !providerName.toLowerCase().includes("agnes") && providerName !== "local_llm" && providerName !== "gemini" && providerName !== "anthropic" && !baseURL) {
        throw new Error(`不支持的模型提供商 (且未配置 Base URL): ${providerName}`);
      }
      if (providerName === "openai" && (!apiKey || apiKey === "not-needed" || apiKey === "******")) {
        throw new Error("未配置有效的 OpenAI API Key。请在配置管理面板中填写。");
      }
      if ((providerName === "agnes" || providerName === "agnesai" || providerName.toLowerCase().includes("agnes")) && (!apiKey || apiKey === "******")) {
        throw new Error("未配置有效的 Agnes API Key。请在配置管理面板中填写。");
      }
      const url = `${baseURL}/chat/completions`;
      
      // Transform history to OpenAI formats
      const messages: any[] = [];
      for (const h of history) {
        if (h.role === "user") {
          const toolResponses = h.parts.filter((p: any) => p.functionResponse);
          if (toolResponses.length > 0) {
            for (const tr of toolResponses) {
              messages.push({
                role: "tool",
                tool_call_id: tr.functionResponse.id,
                name: tr.functionResponse.name,
                content: typeof tr.functionResponse.response === "string" 
                  ? tr.functionResponse.response 
                  : JSON.stringify(tr.functionResponse.response)
              });
            }
          } else {
            messages.push({
              role: "user",
              content: h.parts[0]?.text || ""
            });
          }
        } else if (h.role === "model" || h.role === "assistant") {
          const fc = h.functionCalls;
          messages.push({
            role: "assistant",
            content: h.parts?.[0]?.text || null,
            tool_calls: fc && fc.length > 0 ? fc.map((call: any) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args)
              }
            })) : undefined
          });
        }
      }
      
      const formattedTools = toolsList.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
      
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey && apiKey !== "local-bypass" && apiKey !== "******") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: "system", content: systemInstruction },
              ...messages
            ],
            tools: formattedTools.length > 0 ? formattedTools : undefined,
            temperature,
            max_tokens: provider.parameters?.maxTokens || 4096
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI-compatible API request failed: Status ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        const message = data.choices?.[0]?.message;
        const text = message?.content || "";
        const toolCalls = message?.tool_calls;
        
        let tokensUsed = 0;
        if (data.usage) {
          if (typeof data.usage.total_tokens === "number") {
            tokensUsed = data.usage.total_tokens;
          } else if (typeof data.usage.input_tokens === "number" && typeof data.usage.output_tokens === "number") {
            tokensUsed = data.usage.input_tokens + data.usage.output_tokens;
          } else if (typeof data.usage.prompt_tokens === "number" && typeof data.usage.completion_tokens === "number") {
            tokensUsed = data.usage.prompt_tokens + data.usage.completion_tokens;
          } else if (typeof data.usage.promptTokenCount === "number" && typeof data.usage.candidatesTokenCount === "number") {
            tokensUsed = data.usage.promptTokenCount + data.usage.candidatesTokenCount;
          }
        }
        
        const functionCalls = toolCalls?.map((tc: any) => ({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
          id: tc.id
        }));
        
        return { text, functionCalls, tokensUsed };
      } catch (fetchErr: any) {
        if (providerName === "local_llm" || baseURL.includes("127.0.0.1:11434") || baseURL.includes("localhost:11434")) {
          throw new Error(`无法连接到本地大模型服务 (Ollama)。请确保您的本地 Ollama 服务已经启动（默认运行在 http://localhost:11434，并允许跨域请求），或者进入“模型池”面板，将系统切换至其他可用的在线模型提供商（如 Gemini 或 Agnes）。原始错误原因: ${fetchErr.message}`);
        }
        throw fetchErr;
      }
    }
    
    case "anthropic": {
      if (!apiKey || apiKey === "******") {
        throw new Error("未配置有效的 Anthropic API Key。请在配置管理面板中填写。");
      }
      const url = `${baseURL}/messages`;
      
      const messages: any[] = [];
      for (const h of history) {
        if (h.role === "user") {
          const toolResponses = h.parts.filter((p: any) => p.functionResponse);
          if (toolResponses.length > 0) {
            messages.push({
              role: "user",
              content: toolResponses.map((tr: any) => ({
                type: "tool_result",
                tool_use_id: tr.functionResponse.id,
                content: typeof tr.functionResponse.response === "string" 
                  ? tr.functionResponse.response 
                  : JSON.stringify(tr.functionResponse.response)
              }))
            });
          } else {
            messages.push({
              role: "user",
              content: h.parts[0]?.text || ""
            });
          }
        } else if (h.role === "model" || h.role === "assistant") {
          const fc = h.functionCalls;
          const content: any[] = [];
          if (h.parts?.[0]?.text) {
            content.push({ type: "text", text: h.parts[0].text });
          }
          if (fc && fc.length > 0) {
            fc.forEach((call: any) => {
              content.push({
                type: "tool_use",
                id: call.id,
                name: call.name,
                input: call.args
              });
            });
          }
          messages.push({ role: "assistant", content });
        }
      }
      
      const formattedTools = toolsList.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: modelName,
          system: systemInstruction,
          messages,
          tools: formattedTools.length > 0 ? formattedTools : undefined,
          temperature,
          max_tokens: provider.parameters?.maxTokens || 4096
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API request failed: Status ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      
      let text = "";
      const functionCalls: any[] = [];
      if (data.content && Array.isArray(data.content)) {
        for (const item of data.content) {
          if (item.type === "text") {
            text += item.text;
          } else if (item.type === "tool_use") {
            functionCalls.push({
              name: item.name,
              args: item.input,
              id: item.id
            });
          }
        }
      }
      
      const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
      return { text, functionCalls, tokensUsed };
    }
  }
}
