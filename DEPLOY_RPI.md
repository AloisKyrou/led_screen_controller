# Update the Pi over its own Wi-Fi

The established method is **SCP/SSH from the laptop**, without connecting the
Pi to Internet. Do not change its Wi-Fi AP or Ethernet/ArtNet configuration.

| Setting | Value |
| --- | --- |
| Wi-Fi | NOOLS-HOSTAPD |
| SSH | alois@192.168.50.1 |
| Application | /home/alois/led-screen-controller |
| Service | led-screen.service |
| Admin | http://192.168.50.1:3000/admin/ |
| Guest interface | http://192.168.50.1:3000/message/ |

Passwords are entered interactively, not stored here. Note the hyphens in the
Pi directory name. Ethernet `2.0.0.200/8` is reserved for the panel.

## Prepare locally

From the repository root, install dependencies while Internet is available if
needed (`npm ci`), then run `npm test`. Continue only if tests pass.

In PowerShell, create a source-only archive:

```powershell
$bundle = Join-Path $env:USERPROFILE 'Downloads\led-screen-update.tar.gz'
tar -czf $bundle server.js public effects lib package.json package-lock.json test test-support README.md AGENTS.md DEPLOY_RPI.md CONTEXT_HANDOFF.md RASPBERRY_PI_RUNBOOK.md .gitignore
if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed' }
```

On Linux/macOS, use the same tar command with
`$HOME/led-screen-update.tar.gz` instead of `$bundle`.

The archive includes new source files and bundled GIFs, but excludes runtime
JSON, guest uploads, secrets, `.git` and `node_modules`. It packages the current
working tree; check `git status` to know whether it matches a commit.

Never copy Windows node_modules to the Pi. This method uses dependencies already
installed there. If the dependency lockfile changes, arrange a Linux/ARM-compatible
dependency installation before deployment; copying source alone is insufficient.

## Transfer

Connect to **NOOLS-HOSTAPD**, accepting that it has no Internet. In PowerShell:

```powershell
scp $bundle alois@192.168.50.1:/home/alois/led-screen-update.tar.gz
if ($LASTEXITCODE -ne 0) { throw 'Transfer failed' }
ssh alois@192.168.50.1
```

On Linux/macOS, replace `$bundle` with the archive path.

## Back up, install and restart

Run this block **inside the SSH session on the Pi**:

```bash
deploy_panel() {
  local app=/home/alois/led-screen-controller
  local bundle=/home/alois/led-screen-update.tar.gz
  local backup="$HOME/led-screen-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  test -d "$app" && tar -tzf "$bundle" >/dev/null || return 1
  sudo systemctl stop led-screen.service || return 1
  if ! tar --exclude=node_modules --exclude=.git -czf "$backup" \
      -C /home/alois led-screen-controller; then
    echo 'Backup failed; code was not replaced.'
    sudo systemctl start led-screen.service
    return 1
  fi
  echo "Backup: $backup"
  if ! tar -xzf "$bundle" -C "$app"; then
    echo 'Extraction failed; service remains stopped. Restore backup.'
    return 1
  fi
  sudo systemctl start led-screen.service || return 1
  systemctl is-active led-screen.service
  journalctl -u led-screen.service -n 50 --no-pager
}
deploy_panel
```

Keep the printed backup path. Refresh admin with **Ctrl+F5**, then check the
physical panel and microphone. A running service is not a hardware visual test.

This preserves `effects.json`, `text.json`, `scene.json`, `media.json`,
`messages.json`, `audio.json`, `public-gifs/`, and environment secrets. The backup
includes application data, but not external system configuration, which this
procedure does not modify. Extraction adds/replaces files; it does not delete
files absent from the update.

## Recovery

Stop the service, extract the exact backup printed earlier into `/home/alois`,
then restart only if extraction succeeds:

```bash
sudo systemctl stop led-screen.service
# Replace the placeholder with your actual backup path.
tar -xzf /home/alois/led-screen-backup-YYYYMMDD-HHMMSS.tar.gz -C /home/alois &&
sudo systemctl start led-screen.service
journalctl -u led-screen.service -n 50 --no-pager
```

This restores saved application state too. It does not remove newly introduced
files; inspect new effect modules when rolling back, since modules are discovered
from disk. Do not delete the application directory or its media as a shortcut.

See [RASPBERRY_PI_RUNBOOK.md](RASPBERRY_PI_RUNBOOK.md) for provisioning and deeper
diagnostics. Deployment is separate from commit/push: record the commit actually
installed on the Pi.
