import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

// Get version from environment, git tag, or package.json
function getVersion(): string {
  // 1. Environment variable (set by GitHub Actions)
  if (process.env.VERSION) {
    return process.env.VERSION;
  }

  // 2. Downstream fork naming format: v<upstream_tag>+<patch_count>-<sha>
  try {
    const commitSha = execSync('git rev-parse --short=7 HEAD 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    const upstreamTag = execSync(
      'git tag -l "v*" --merged upstream/main --sort=-v:refname 2>/dev/null | head -n 1 || git describe --tags --abbrev=0 2>/dev/null || echo "v1.26.2"',
      { encoding: 'utf8' }
    ).trim();
    let patchCount = '0';
    try {
      patchCount = execSync('git rev-list --count upstream/main..HEAD 2>/dev/null || echo "0"', { encoding: 'utf8' }).trim();
    } catch {
      // ignore
    }
    if (commitSha && upstreamTag) {
      if (patchCount && patchCount !== '0') {
        return `${upstreamTag}+${patchCount}-${commitSha}`;
      }
      return `${upstreamTag}-${commitSha}`;
    }
  } catch {
    // Git not available or error
  }

  // 3. Try git tag
  try {
    const gitTag = execSync('git describe --tags --exact-match 2>/dev/null || git describe --tags 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (gitTag) {
      return gitTag;
    }
  } catch {
    // Git not available or no tags
  }

  // 4. Fall back to package.json version
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
    if (pkg.version && pkg.version !== '0.0.0') {
      return pkg.version;
    }
  } catch {
    // package.json not readable
  }

  return 'dev';
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile({
      removeViteModuleLoader: true
    })
  ],
  define: {
    __APP_VERSION__: JSON.stringify(getVersion())
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: '[name]__[local]___[hash:base64:5]'
    },
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`
      }
    }
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        codeSplitting: false
      }
    }
  }
});
