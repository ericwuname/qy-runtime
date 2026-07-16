import fs from "fs";
import path from "path";
import { safePath } from "./security";

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");

export interface SymbolInfo {
  name: string;
  type: "class" | "function" | "variable" | "interface" | "import" | "other";
  filePath: string;
  line: number;
  signature?: string;
}

export interface RepoIndex {
  files: string[];
  symbols: SymbolInfo[];
  lastIndexedAt: string;
  totalFiles: number;
  totalSymbols: number;
}

let cachedIndex: RepoIndex = {
  files: [],
  symbols: [],
  lastIndexedAt: "",
  totalFiles: 0,
  totalSymbols: 0,
};

let isIndexing = false;

// Scan directory recursively
function getFilesRecursive(dir: string, baseDir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(baseDir, fullPath);
    
    // Ignore hidden dirs, node_modules, dist, etc.
    if (file.startsWith(".") || file === "node_modules" || file === "dist" || file === "bower_components") {
      continue;
    }
    
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursive(fullPath, baseDir));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

// Extract symbols from file content
function extractSymbols(relPath: string, content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = content.split("\n");
  const ext = path.extname(relPath).toLowerCase();

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    if (ext === ".py") {
      // Python parser
      const defMatch = trimmed.match(/^def\s+([a-zA-Z0-9_]+)\s*\((.*?)\):/);
      if (defMatch) {
        symbols.push({
          name: defMatch[1],
          type: "function",
          filePath: relPath,
          line: lineNum,
          signature: `def ${defMatch[1]}(${defMatch[2]})`
        });
        return;
      }

      const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)(?:\((.*?)\))?\s*:/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: "class",
          filePath: relPath,
          line: lineNum,
          signature: `class ${classMatch[1]}`
        });
        return;
      }
    } else if ([".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      // TS / JS parser
      // 1. Classes
      const classMatch = trimmed.match(/(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: "class",
          filePath: relPath,
          line: lineNum,
          signature: `class ${classMatch[1]}`
        });
        return;
      }

      // 2. Standard function
      const funcMatch = trimmed.match(/(?:export\s+)?function\s+([a-zA-Z0-9_$]+)\s*\((.*?)\)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          type: "function",
          filePath: relPath,
          line: lineNum,
          signature: `function ${funcMatch[1]}(${funcMatch[2].slice(0, 50)})`
        });
        return;
      }

      // 3. Arrow function / constant export
      const arrowMatch = trimmed.match(/(?:export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:\(.*?\)|[a-zA-Z0-9_$]+)\s*=>/);
      if (arrowMatch) {
        symbols.push({
          name: arrowMatch[1],
          type: "function",
          filePath: relPath,
          line: lineNum,
          signature: `const ${arrowMatch[1]} = (...) => ...`
        });
        return;
      }

      // 4. Interfaces and types
      const interfaceMatch = trimmed.match(/(?:export\s+)?(?:interface|type)\s+([a-zA-Z0-9_$]+)/);
      if (interfaceMatch) {
        symbols.push({
          name: interfaceMatch[1],
          type: "interface",
          filePath: relPath,
          line: lineNum,
          signature: `interface ${interfaceMatch[1]}`
        });
        return;
      }

      // 5. Imports
      if (trimmed.startsWith("import ")) {
        const importMatch = trimmed.match(/import\s+({?.*?}?)\s+from\s+["'](.*?)["']/);
        if (importMatch) {
          symbols.push({
            name: importMatch[1].trim(),
            type: "import",
            filePath: relPath,
            line: lineNum,
            signature: `import from "${importMatch[2]}"`
          });
        }
      }
    }
  });

  return symbols;
}

// Reindex the whole workspace
export async function reindexWorkspace(): Promise<RepoIndex> {
  if (isIndexing) return cachedIndex;
  isIndexing = true;

  try {
    const files = getFilesRecursive(WORKSPACE_DIR, WORKSPACE_DIR);
    const symbols: SymbolInfo[] = [];

    for (const relPath of files) {
      try {
        const absPath = path.join(WORKSPACE_DIR, relPath);
        const stat = fs.statSync(absPath);
        
        // Skip large files
        if (stat.size > 200 * 1024) continue;

        const content = fs.readFileSync(absPath, "utf-8");
        const fileSymbols = extractSymbols(relPath, content);
        symbols.push(...fileSymbols);
      } catch (err) {
        console.error(`Indexer failed on file ${relPath}:`, err);
      }
    }

    cachedIndex = {
      files,
      symbols,
      lastIndexedAt: new Date().toISOString(),
      totalFiles: files.length,
      totalSymbols: symbols.length,
    };

    return cachedIndex;
  } finally {
    isIndexing = false;
  }
}

// Get current cached index (or index if empty)
export async function getRepoIndex(): Promise<RepoIndex> {
  if (cachedIndex.files.length === 0 && !isIndexing) {
    await reindexWorkspace();
  }
  return cachedIndex;
}

// Search symbols
export async function searchSymbols(query: string): Promise<SymbolInfo[]> {
  const index = await getRepoIndex();
  if (!query) return index.symbols.slice(0, 100);
  
  const lowerQuery = query.toLowerCase();
  return index.symbols.filter(sym => 
    sym.name.toLowerCase().includes(lowerQuery) ||
    sym.filePath.toLowerCase().includes(lowerQuery)
  );
}
