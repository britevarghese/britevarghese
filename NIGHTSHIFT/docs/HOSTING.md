# Hosting NIGHTSHIFT

One PC runs the server. Everyone else opens its URL in a browser (Chrome, Edge or Firefox). The server is a single Node.js file (`server.js`) with no npm dependencies.

## Option 1: Installer (Windows, easiest)

1. Run `NIGHTSHIFT_SERVER_SETUP.exe` and accept the admin prompt. Node.js is bundled.
2. It installs to `C:\Program Files\NIGHTSHIFT Server` (you can change this), adds Start Menu and Desktop shortcuts named **Start Nightshift Server**, and adds a Windows Firewall rule for TCP port 3000.
3. Double-click **Start Nightshift Server**. Leave the console window open while people play.

Uninstall from *Settings > Apps* or the Start Menu. This also removes the firewall rule.

A portable zip (`NIGHTSHIFT_SERVER_portable.zip`) is available too. Extract it anywhere and run `start.bat`. You have to add the firewall rule yourself (see below).

## Option 2: start.bat (Windows, from source)

Install Node.js 18 or newer (LTS) from https://nodejs.org, then double-click `start.bat`. If a `runtime\node.exe` is present, it is used instead of the system Node. You don't need to run `npm install`.

## Option 3: Linux / macOS

```sh
./start.sh                  # or: node server.js
./start.sh --port 8080      # extra arguments are passed through
```

## Which URL do players use?

The startup banner lists every address the server is reachable on:

```
 LOCAL:  http://localhost:3000       <- this PC only
 LAN:    http://192.168.1.100:3000   <- same home/office network
 RADMIN: http://26.x.x.x:3000        <- Radmin VPN network members
 VPN:    http://100.x.x.x:3000       <- Tailscale / CGNAT VPN
 NETWORK: http://...                 <- any other adapter
```

- **LAN**: players on the same Wi-Fi/router use the `LAN` address. To find it by hand, run `ipconfig` (Windows) and look at *IPv4 Address*, or `ip -4 addr` on Linux.
- **Radmin VPN**: the host and all players join the same Radmin network. Players use the host's `26.x.x.x` address, which is also shown in the Radmin window.
- **Internet without a VPN**: forward TCP port 3000 on your router to the host PC and share your public IP. A VPN such as Radmin or Tailscale is simpler and safer.

## Firewall

The installer adds the rule for you. To add it manually, open an **admin** Command Prompt and run:

```bat
netsh advfirewall firewall add rule name="NIGHTSHIFT Server" dir=in action=allow protocol=TCP localport=3000
```

To remove it:

```bat
netsh advfirewall firewall delete rule name="NIGHTSHIFT Server"
```

The first time `node.exe` runs, Windows may also show an "Allow access" dialog. Tick **Private networks** and click Allow.

## Changing the port or host

Settings are applied in this order of priority (highest first):

1. Command line: `start.bat --port 8080 --host 0.0.0.0`
2. Environment variables: `PORT`, `HOST`
3. `config.json` in the install folder:

```json
{ "port": 3000, "host": "0.0.0.0", "serverName": "NIGHTSHIFT Server",
  "multiplayer": { "enabled": true, "tickRate": 20, "maxPlayers": 8 } }
```

If you change the port, update the firewall rule to match (`localport=<new port>`).

`host` `0.0.0.0` means "all network adapters". Set it to `127.0.0.1` to allow only this PC.

Useful endpoints: `/api/health` (status and uptime) and `/api/config` (server name, version, multiplayer flags).

## Troubleshooting

| Problem | Fix |
|---|---|
| Console window flashes and closes / "Node.js was not found" | Install Node.js LTS from nodejs.org, or use the installer (it bundles Node). |
| `Port 3000 is already in use` | Another copy of the server is probably already running, so close it. Or start on another port: `start.bat --port 3001`. |
| Blank or black page | Hard-refresh with Ctrl+F5. Use a current Chrome, Edge or Firefox with hardware acceleration and WebGL enabled. Open DevTools (F12) > Console to see errors. Open the `http://...` URL, not the HTML file directly (`file://` won't work). |
| Works on the host, but other PCs can't connect | 1) Check the firewall rule (above). 2) In Windows *Settings > Network*, set the network profile to **Private**. The Public profile blocks incoming connections. 3) Make sure the player uses the host's LAN/Radmin IP, not `localhost`. 4) Check both PCs are on the same network, or joined to the same Radmin network with the host showing as online. 5) Some routers have "AP/client isolation" on guest Wi-Fi, so use the main network. |
| Radmin address doesn't appear in the banner | Start Radmin VPN and join or create a network before starting the server. Then restart the server. |
| Slow first load | Models and textures are cached by the browser for one day, so later loads are fast. |

## Multiplayer

The server has a built-in WebSocket endpoint at `/ws`, and multiplayer is **on by default**:
everyone who opens the server's address (LAN, Radmin VPN or the online URL) plays in the same
city, up to `maxPlayers` (8). Players see each other with name tags, can bump each other's cars,
and can take the cars other players leave parked. The server checks each update: speed is capped
at 120 m/s, and jumps of more than 60 m are rejected unless the client announces a teleport
(respawn, reset). To turn it off, start with `start.bat --no-multiplayer` or set
`"multiplayer": { "enabled": false }` in `config.json`. When it is off, `/ws` returns 403.
Render and most hosts pass WebSockets through without extra setup.
