# Screen Vision MCP Server

A Model Context Protocol (MCP) server that provides comprehensive screen capture, OCR, and visual understanding capabilities for macOS.

## Features

- **capture_fullscreen**: Capture the entire screen
- **capture_window**: Capture specific application windows
- **capture_region**: Capture defined screen regions
- **extract_text_from_screen**: OCR text extraction from screenshots
- **find_text_on_screen**: Locate text on screen and return coordinates
- **get_window_list**: List all open windows with details
- **get_screen_info**: Get display and screen information
- **click_at_position**: Automated clicking at specific coordinates
- **monitor_screen_region**: Monitor regions for changes over time
- Screenshot resource management and retrieval

## Installation

### Quick Install
```bash
npm install -g screen-vision-mcp
```

### From Source
1. Clone the repository:
   ```bash
   git clone https://github.com/TIMBOTGPT/screen-vision-mcp.git
   cd screen-vision-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Test the server:
   ```bash
   npm start
   ```

## Usage with Claude Desktop

Add this server to your Claude Desktop MCP configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "screen-vision": {
      "command": "npx",
      "args": ["-y", "screen-vision-mcp"],
      "description": "Screen capture and vision analysis"
    }
  }
}
```

Or if installed locally:
```json
{
  "mcpServers": {
    "screen-vision": {
      "command": "node",
      "args": ["/path/to/screen-vision-mcp/index.js"],
      "description": "Screen capture and vision analysis"
    }
  }
}
```

## Available Tools

### capture_fullscreen
Capture the entire screen.

**Parameters:**
- `save_path` (optional): Custom save path for the screenshot

**Example:**
```json
{
  "name": "capture_fullscreen",
  "arguments": {
    "save_path": "/path/to/save/screenshot.png"
  }
}
```

### capture_window
Capture a specific application window.

**Parameters:**
- `app_name` (required): Name of the application (e.g., "Safari", "Terminal")
- `save_path` (optional): Custom save path

**Example:**
```json
{
  "name": "capture_window",
  "arguments": {
    "app_name": "Safari",
    "save_path": "/path/to/save/window.png"
  }
}
```

### capture_region
Capture a specific region of the screen.

**Parameters:**
- `x` (required): X coordinate
- `y` (required): Y coordinate
- `width` (required): Width of region
- `height` (required): Height of region
- `save_path` (optional): Custom save path

### extract_text_from_screen
Capture screen and extract text using OCR.

**Parameters:**
- `region` (optional): Specific region to capture
  - `x`, `y`, `width`, `height`: Region coordinates

### find_text_on_screen
Find text on screen and return its location.

**Parameters:**
- `text` (required): Text to search for
- `case_sensitive` (optional): Whether search should be case sensitive (default: false)

### get_window_list
Get list of all open windows with their positions.

### get_screen_info
Get information about available screens/displays.

### click_at_position
Click at a specific screen position.

**Parameters:**
- `x` (required): X coordinate
- `y` (required): Y coordinate
- `button` (optional): Mouse button ('left', 'right', 'middle', default: 'left')
- `double_click` (optional): Whether to double-click (default: false)

### monitor_screen_region
Monitor a screen region for changes over time.

**Parameters:**
- `x`, `y`, `width`, `height` (required): Region to monitor
- `duration_seconds` (optional): How long to monitor (max 30 seconds, default: 5)
- `interval_ms` (optional): Check interval in milliseconds (default: 1000)

## Requirements

- macOS (uses native `screencapture` command)
- Node.js 16+
- Claude Desktop with MCP support
- Screen recording permissions for automation features

## Permissions

On first use, macOS may request permissions for:
- Screen recording
- Accessibility (for clicking automation)
- File system access (for saving screenshots)

Grant these permissions in System Preferences > Security & Privacy.

## Screenshots Storage

Screenshots are automatically saved to a `screenshots/` directory within the server folder. You can:
- Access screenshots via the resource URI system
- Optionally set `save_path` to a **filename or path relative to `screenshots/`** (paths outside this directory are rejected)
- View saved screenshots through Claude's resource system

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Advanced Features

### OCR Integration
The server includes hooks for macOS Vision framework integration for advanced OCR capabilities. Full OCR requires additional setup with native macOS Vision APIs.

### Automation
The clicking and monitoring features enable automation workflows when combined with other MCP servers.

## Security

- **Path containment**: Custom `save_path` is restricted to the server’s `screenshots/` directory; path traversal (e.g. `../`) is rejected.
- **Input validation**: Tool arguments (coordinates, dimensions, `app_name`) are validated and sanitized to prevent command injection.
- **Resource reads**: Screenshot resources are served only by basename; URI path traversal cannot read files outside `screenshots/`.
- **Error responses**: Client-facing errors are generic; detailed messages are logged server-side only.
- All screen captures require explicit macOS permission (Screen Recording, Accessibility).
- No network access required for core functionality.
- **Dependency**: `@modelcontextprotocol/sdk` may have advisories (e.g. ReDoS in UriTemplate). This server uses simple `screenshot://` resource URIs only. For a fully patched stack, consider upgrading to `@modelcontextprotocol/sdk@^1.25.2` when migrating to the 1.x API.

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions, please use the [GitHub Issues](https://github.com/TIMBOTGPT/screen-vision-mcp/issues) page.
