# User guide
1. **First launch** runs a read-only scan. Nothing is changed.
2. **Marketplace** → Refresh sources → filter → open a listing → *Review installation plan* → read the exact file list and findings → approve. Choose Global or a registered project.
3. **My Skills**: inspect (11 tabs), enable/disable (reversible `skillOverrides`), update, pin, copy to another scope, export, uninstall. Everything has a backup (**Backups**).
4. **MCP Servers**: add/edit/import/export/delete; *Test connection* asks first, only lists tools. A passing test does not prove Claude loaded the server.
5. **Projects**: register folders you choose; see project resources and settings inheritance.
6. **Skill Studio**: wizard/templates → edit → validate → save. Test cases are static/simulated unless you explicitly run real Claude.
7. **Organizations / Presets**: connect catalogs (URL, GitHub file, local file) and apply reviewed bundles.
8. **Settings**: theme, optional GitHub token (OS keychain) for private repos.
Run from source: `npm install && npm run dev`. Build: `npm run package`.
