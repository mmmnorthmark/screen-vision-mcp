#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { exec, execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create screenshots directory
const SCREENSHOTS_DIR = path.resolve(path.join(__dirname, 'screenshots'));
await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

// --- Security: path containment and input validation (exfil / sandbox) ---

/**
 * Resolve a path and ensure it is strictly under SCREENSHOTS_DIR. Rejects path traversal.
 * @param {string} relativeOrFilename - Filename or relative path (no leading slashes for absolute intent).
 * @returns {string} Resolved path under SCREENSHOTS_DIR.
 * @throws {Error} If path escapes SCREENSHOTS_DIR.
 */
function resolvePathWithinScreenshots(relativeOrFilename) {
  const normalized = path.normalize(relativeOrFilename).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.resolve(SCREENSHOTS_DIR, normalized);
  const base = path.resolve(SCREENSHOTS_DIR);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Invalid path: must be under screenshots directory');
  }
  return resolved;
}

/**
 * Validate numeric screen parameter (coordinate or dimension).
 */
function validateScreenNumber(value, name, max = 10000) {
  const n = Number(value);
  if (typeof value === 'undefined' || value === null || Number.isNaN(n) || n < 0 || n > max) {
    throw new Error(`Invalid ${name}: must be a number between 0 and ${max}`);
  }
  return n;
}

/** Allowlist for app_name: alphanumeric, spaces, hyphen, underscore only (no shell metacharacters). */
const APP_NAME_ALLOW = /^[a-zA-Z0-9 _-]+$/;

function validateAppName(appName) {
  if (typeof appName !== 'string' || !appName.trim()) {
    throw new Error('Invalid app_name: required non-empty string');
  }
  if (!APP_NAME_ALLOW.test(appName)) {
    throw new Error('Invalid app_name: only letters, numbers, spaces, hyphen, underscore allowed');
  }
  return appName.trim();
}

class ScreenVisionServer {
  constructor() {
    this.server = new Server(
      {
        name: 'screen-vision-mcp',
        version: '1.0.0',
        description: 'Screen capture, OCR, and visual understanding for macOS',
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'capture_fullscreen',
          description: 'Capture the entire screen',
          inputSchema: {
            type: 'object',
            properties: {
              save_path: {
                type: 'string',
                description: 'Optional custom save path for the screenshot'
              }
            }
          }
        },
        {
          name: 'capture_window',
          description: 'Capture a specific window by app name',
          inputSchema: {
            type: 'object',
            properties: {
              app_name: {
                type: 'string',
                description: 'Name of the application (e.g., "Safari", "Terminal")'
              },
              save_path: {
                type: 'string',
                description: 'Optional custom save path'
              }
            },
            required: ['app_name']
          }
        },
        {
          name: 'capture_region',
          description: 'Capture a specific region of the screen',
          inputSchema: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X coordinate' },
              y: { type: 'number', description: 'Y coordinate' },
              width: { type: 'number', description: 'Width of region' },
              height: { type: 'number', description: 'Height of region' },
              save_path: { type: 'string', description: 'Optional save path' }
            },
            required: ['x', 'y', 'width', 'height']
          }
        },
        {
          name: 'extract_text_from_screen',
          description: 'Capture screen and extract text using OCR',
          inputSchema: {
            type: 'object',
            properties: {
              region: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' }
                },
                description: 'Optional region to capture. If not provided, captures full screen'
              }
            }
          }
        },
        {
          name: 'find_text_on_screen',
          description: 'Find text on screen and return its location',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Text to search for on screen'
              },
              case_sensitive: {
                type: 'boolean',
                description: 'Whether search should be case sensitive',
                default: false
              }
            },
            required: ['text']
          }
        },
        {
          name: 'get_window_list',
          description: 'Get list of all open windows with their positions',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_screen_info',
          description: 'Get information about available screens/displays',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'click_at_position',
          description: 'Click at a specific screen position',
          inputSchema: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X coordinate' },
              y: { type: 'number', description: 'Y coordinate' },
              button: {
                type: 'string',
                enum: ['left', 'right', 'middle'],
                default: 'left',
                description: 'Mouse button to click'
              },
              double_click: {
                type: 'boolean',
                default: false,
                description: 'Whether to double-click'
              }
            },
            required: ['x', 'y']
          }
        },
        {
          name: 'monitor_screen_region',
          description: 'Monitor a screen region for changes',
          inputSchema: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              duration_seconds: {
                type: 'number',
                description: 'How long to monitor (max 30 seconds)',
                default: 5
              },
              interval_ms: {
                type: 'number',
                description: 'Check interval in milliseconds',
                default: 1000
              }
            },
            required: ['x', 'y', 'width', 'height']
          }
        }
      ]
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'capture_fullscreen':
            return await this.captureFullscreen(args);
          case 'capture_window':
            return await this.captureWindow(args);
          case 'capture_region':
            return await this.captureRegion(args);
          case 'extract_text_from_screen':
            return await this.extractTextFromScreen(args);
          case 'find_text_on_screen':
            return await this.findTextOnScreen(args);
          case 'get_window_list':
            return await this.getWindowList();
          case 'get_screen_info':
            return await this.getScreenInfo();
          case 'click_at_position':
            return await this.clickAtPosition(args);
          case 'monitor_screen_region':
            return await this.monitorScreenRegion(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error('Tool error:', name, error);
        return {
          content: [
            {
              type: 'text',
              text: 'Tool execution failed'
            }
          ]
        };
      }
    });

    // List screenshot resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const files = await fs.readdir(SCREENSHOTS_DIR);
      const screenshots = files.filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
      
      return {
        resources: screenshots.map(file => ({
          uri: `screenshot://${file}`,
          name: file,
          mimeType: 'image/png',
          description: `Screenshot: ${file}`
        }))
      };
    });

    // Read screenshot resources (path traversal safe: only files under SCREENSHOTS_DIR by basename)
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri.startsWith('screenshot://')) {
        const raw = uri.replace('screenshot://', '');
        const filename = path.basename(raw);
        if (!filename || filename !== raw || /[\\/]/.test(raw)) {
          throw new Error('Invalid resource URI');
        }
        const filepath = resolvePathWithinScreenshots(filename);

        try {
          const data = await fs.readFile(filepath, 'base64');
          return {
            contents: [
              {
                uri,
                mimeType: 'image/png',
                text: data
              }
            ]
          };
        } catch (error) {
          console.error('ReadResource failed:', error);
          throw new Error('Failed to read screenshot');
        }
      }

      throw new Error('Unknown resource URI');
    });
  }

  async captureFullscreen(args) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `fullscreen-${timestamp}.png`;
    const filepath = args.save_path
      ? resolvePathWithinScreenshots(args.save_path)
      : path.join(SCREENSHOTS_DIR, filename);

    await execFileAsync('screencapture', ['-x', filepath]);

    return {
      content: [
        {
          type: 'text',
          text: `Screenshot saved to: ${filepath}`
        }
      ]
    };
  }

  async captureWindow(args) {
    const appName = validateAppName(args.app_name);
    const save_path = args.save_path;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `window-${appName}-${timestamp}.png`;
    const filepath = save_path
      ? resolvePathWithinScreenshots(save_path)
      : path.join(SCREENSHOTS_DIR, filename);

    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        if frontApp is "${appName}" then
          return "current"
        else
          tell application "${appName}" to activate
          delay 0.5
          return "activated"
        end if
      end tell
    `;
    await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);

    const { stdout: windowId } = await execAsync(`osascript -e 'tell application "${appName}" to id of window 1'`);
    await execFileAsync('screencapture', ['-x', '-o', '-l' + String(windowId).trim(), filepath]);

    return {
      content: [
        {
          type: 'text',
          text: `Window screenshot saved to: ${filepath}`
        }
      ]
    };
  }

  async captureRegion(args) {
    const x = validateScreenNumber(args.x, 'x');
    const y = validateScreenNumber(args.y, 'y');
    const width = validateScreenNumber(args.width, 'width');
    const height = validateScreenNumber(args.height, 'height');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `region-${timestamp}.png`;
    const filepath = args.save_path
      ? resolvePathWithinScreenshots(args.save_path)
      : path.join(SCREENSHOTS_DIR, filename);

    await execFileAsync('screencapture', ['-x', '-R' + [x, y, width, height].join(','), filepath]);

    return {
      content: [
        {
          type: 'text',
          text: `Region screenshot saved to: ${filepath}`
        }
      ]
    };
  }

  async extractTextFromScreen(args) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ocr-${timestamp}.png`;
    const filepath = path.join(SCREENSHOTS_DIR, filename);

    if (args.region) {
      const { x, y, width, height } = args.region;
      const rx = validateScreenNumber(x, 'region.x');
      const ry = validateScreenNumber(y, 'region.y');
      const rw = validateScreenNumber(width, 'region.width');
      const rh = validateScreenNumber(height, 'region.height');
      await execFileAsync('screencapture', ['-x', '-R' + [rx, ry, rw, rh].join(','), filepath]);
    } else {
      await execFileAsync('screencapture', ['-x', filepath]);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Screenshot captured at: ${filepath}\nNote: OCR functionality requires additional setup with macOS Vision framework.`
        }
      ]
    };
  }

  async findTextOnScreen(args) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(SCREENSHOTS_DIR, `find-text-${timestamp}.png`);
    await execFileAsync('screencapture', ['-x', filepath]);

    return {
      content: [
        {
          type: 'text',
          text: `Screenshot captured for text search: ${filepath}\nNote: Text search requires Vision framework integration.`
        }
      ]
    };
  }

  async getWindowList() {
    const script = `
      tell application "System Events"
        set windowList to {}
        repeat with proc in application processes
          if background only of proc is false then
            set procName to name of proc
            try
              repeat with win in windows of proc
                set winInfo to {appName:procName, windowTitle:(name of win)}
                set end of windowList to winInfo
              end repeat
            end try
          end if
        end repeat
        return windowList
      end tell
    `;
    
    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
      return {
        content: [
          {
            type: 'text',
            text: `Open windows:\n${stdout}`
          }
        ]
      };
    } catch (error) {
      console.error('getWindowList failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: 'Error getting window list'
          }
        ]
      };
    }
  }

  async getScreenInfo() {
    try {
      const { stdout } = await execAsync('system_profiler SPDisplaysDataType -json');
      const displays = JSON.parse(stdout);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(displays.SPDisplaysDataType[0]._items, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('getScreenInfo failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: 'Error getting screen info'
          }
        ]
      };
    }
  }

  async clickAtPosition(args) {
    const x = validateScreenNumber(args.x, 'x');
    const y = validateScreenNumber(args.y, 'y');
    const button = args.button === 'right' || args.button === 'middle' ? args.button : 'left';
    const double_click = Boolean(args.double_click);

    const script = `
      tell application "System Events"
        click at {${x}, ${y}}
        ${double_click ? `delay 0.1\nclick at {${x}, ${y}}` : ''}
      end tell
    `;

    try {
      await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);

      return {
        content: [
          {
            type: 'text',
            text: `${double_click ? 'Double-clicked' : 'Clicked'} at position (${x}, ${y})`
          }
        ]
      };
    } catch (error) {
      console.error('clickAtPosition failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: 'Error clicking at position'
          }
        ]
      };
    }
  }

  async monitorScreenRegion(args) {
    const x = validateScreenNumber(args.x, 'x');
    const y = validateScreenNumber(args.y, 'y');
    const width = validateScreenNumber(args.width, 'width');
    const height = validateScreenNumber(args.height, 'height');
    const duration_seconds = typeof args.duration_seconds === 'number' && args.duration_seconds > 0
      ? Math.min(args.duration_seconds, 30)
      : 5;
    const interval_ms = typeof args.interval_ms === 'number' && args.interval_ms >= 100
      ? Math.min(args.interval_ms, 5000)
      : 1000;
    const maxDuration = Math.min(duration_seconds, 30);
    const changes = [];

    const captureAndCompare = async (index) => {
      const filepath = path.join(SCREENSHOTS_DIR, `monitor-${index}.png`);
      await execFileAsync('screencapture', ['-x', '-R' + [x, y, width, height].join(','), filepath]);
      return filepath;
    };
    
    // Initial capture
    const initialFile = await captureAndCompare(0);
    changes.push({ time: 0, event: 'Initial capture', file: initialFile });
    
    // Monitor for changes (simplified version)
    const startTime = Date.now();
    let index = 1;
    
    while ((Date.now() - startTime) < (maxDuration * 1000)) {
      await new Promise(resolve => setTimeout(resolve, interval_ms));
      
      const currentFile = await captureAndCompare(index);
      changes.push({
        time: (Date.now() - startTime) / 1000,
        event: 'Capture',
        file: currentFile
      });
      
      index++;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `Monitoring complete. ${changes.length} captures taken.\nFiles saved in: ${SCREENSHOTS_DIR}`
        }
      ]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Screen Vision MCP server running on stdio');
  }
}

// Start the server
const server = new ScreenVisionServer();
server.run().catch(console.error);
