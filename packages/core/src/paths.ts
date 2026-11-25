import path from 'node:path'

/** All Claude locations derive from one home dir so tests/e2e can run against an isolated fixture. */
export function claudePaths(home: string) {
  return {
    home,
    claudeDir: path.join(home, '.claude'),
    userJson: path.join(home, '.claude.json'),
    userSettings: path.join(home, '.claude', 'settings.json'),
    pluginsIndex: path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
    managedDirs: process.platform === 'darwin' ? ['/Library/Application Support/ClaudeCode'] : process.platform === 'win32' ? ['C:\\Program Files\\ClaudeCode'] : ['/etc/claude-code']
  }
}
export type ClaudePaths = ReturnType<typeof claudePaths>
